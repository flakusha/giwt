// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { getRootBranch, gitSync, gitSyncQuiet, isProtected } from "../utils/git";
import { assertAgentGpgUnlocked } from "../utils/gpg";
import { appendGripe, printRecentLedger } from "../utils/ledger";
import { colorize, log, raw, section } from "../utils/output";
import { activeRun } from "../utils/runlog";
import { DEV_IN_PROGRESS_HEADS, FINALIZE_STASH_PREFIX } from "./abort";

const LOCK_FILENAME = ".worktree-finalize.lock";
// Signals we treat as user-initiated cancellation. SIGINT (Ctrl-C), SIGTERM
// (orchestrator kill), SIGHUP (terminal close / parent shell exit). All three
// must trigger the same transactional rollback: release lock + abort in-
// progress merge + pop stash. SIGHUP is included because Node's default
// disposition is to exit on SIGHUP just like SIGTERM; without a handler,
// finalize silently loses the lock and leaves dev in a mid-merge state.
const FINALIZE_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
type FinalizeSignal = typeof FINALIZE_SIGNALS[number];
// Exit code used when a signal aborts finalize. 128 + signo is the convention
// shell tools use; we use the same so a wrapper script can distinguish
// signal abort (130 = 128+2=SIGINT) from operator refusal (1).
const SIGNAL_EXIT_CODE = 130;
// Module-scope mutable slot: tracks the most recent rollback target so the
// signal handler can act without arguments. We keep it module-scoped (not
// closure-scoped) because process.on() registrations survive across nested
// finalize calls and we want exactly one rollback path active per process.
// Tests MUST reset this between cases (see src/commands/abort.ts).
interface AbortState {
  stashLabel: string | null;
  mergeHead: string | null;
  mergeInProgress: boolean;
  repoRoot: string;
  branch: string;
}
let ACTIVE_ABORT_STATE: AbortState | null = null;
// Counted reference: each finalize call increments on entry, decrements on
// exit. Signal handlers only fire rollback when refcount drops to 0, so a
// nested finalize (e.g. an inner finalize called from a test fixture) gets
// its own signal-handler lifecycle without prematurely tearing down the
// outer call's lock.
let ACTIVE_FINALIZE_COUNT = 0;
// Module-scoped lock-release function: the `process.on('exit')` cleanup
// handler calls this on every process termination path. `process.exit()` and
// any unhandled throw unwind through the `exit` event before the process
// actually terminates, so this catches the operator-error paths
// (`process.exit(1)` inside helper functions, signal-triggered exit) that
// bypass the outer `try { runFinalize(...) } finally { release() }` block.
// SIGKILL (`kill -9`) bypasses every handler; that is what `giwt abort` is for. release is idempotent (catches ENOENT) so double-release
// from a benign race is harmless.
let ACTIVE_LOCK_RELEASE: (() => void) | null = null;
/**
 * Precheck: refuse to start if the dev checkout is mid-merge / mid-rebase /
 * mid-cherry-pick, has unmerged paths, or has staged-but-uncommitted entries.
 *
 * This is the hard invariant. The lock below is best-effort single-flight;
 * these prechecks catch the cases where the dev tree is in a half-mutated
 * state that no lock acquisition can repair.
 */
function checkDevMergeable(repoRoot: string): void {
  // 1. Unmerged paths (merge/rebase/cherry-pick left a tree with conflicts)
  const unmerged = gitSyncQuiet(repoRoot, "ls-files", "--unmerged");
  if (unmerged.length > 0) {
    log("error", "dev checkout has unmerged paths — resolve or abort before finalizing");
    raw("  git -C " + repoRoot + " status  (then resolve or git merge/rebase/cherry-pick --abort)");
    process.exit(1);
  }

  // 2. In-progress state sentinels (MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD)
  const gitDirRaw = gitSyncQuiet(repoRoot, "rev-parse", "--git-dir");
  const gitDirAbs = resolve(repoRoot, gitDirRaw.startsWith("/") ? gitDirRaw.slice(1) : gitDirRaw);
  for (const name of DEV_IN_PROGRESS_HEADS) {
    if (existsSync(resolve(gitDirAbs, name))) {
      const op = name.replace("_HEAD", "").toLowerCase();
      log(
        "error",
        `dev checkout is mid-${op} (${name} exists) — abort or resolve before finalizing`,
      );
      if (op === "merge") raw("  git merge --abort  (or commit the merge)");
      else if (op === "rebase") raw("  git rebase --abort  (or git rebase --continue)");
      else raw("  git cherry-pick --abort  (or git cherry-pick --continue)");
      process.exit(1);
    }
  }

  // 3. Staged-but-uncommitted entries — these would interfere with the in-place
  // merge the same way untracked dirty files would.
  const staged = gitSyncQuiet(repoRoot, "diff", "--cached", "--name-only");
  if (staged.length > 0) {
    const stagedFiles = staged.split("\n").filter((s) => s.length > 0);
    log("error", `dev checkout has ${stagedFiles.length} staged-but-uncommitted entries`);
    raw("  git -C " + repoRoot + " commit  (or git -C " + repoRoot + " reset)");
    process.exit(1);
  }

  // 4. Leftover finalize stashes from a prior crashed finalize. Garbage from
  // the user's perspective but harmless if we leave them; warn so the
  // operator can `git stash drop` them.
  const stashList = gitSyncQuiet(repoRoot, "stash", "list");
  const leftovers = stashList.split("\n").filter((l) => l.includes(FINALIZE_STASH_PREFIX));
  if (leftovers.length > 0) {
    log(
      "warn",
      `dev has ${leftovers.length} leftover finalize stash(es) from prior crash — review 'git stash list'`,
    );
  }
}

/**
 * Acquire an exclusive finalize lock on the dev checkout.
 *
 * Two concurrent `finalize` invocations race on `repoRoot`: each pushes a
 * stash, runs `git merge`, and pops the stash. Without a lock, A and B both
 * mutate the dev checkout's working tree; whichever finishes second pops
 * the other's stash onto a tree that may already be in rebasing/merge/
 * conflict state, leaving files in "modified" instead of cancelling cleanly.
 *
 * Lock primitive: atomic `O_CREAT|O_EXCL` via Node `openSync(path, 'wx')`.
 * The first caller wins; later callers fail fast. The lockfile content is
 * the PID, so a stale lock from a crashed prior run is detected via
 * `kill -0` and reaped automatically. An empty or corrupt lockfile
 * (SIGKILL between create and PID write) reaps the same way.
 *
 * Returns a release function the caller MUST invoke in a finally block.
 *
 * Exported for unit tests (`src/finalize-lock-cleanup.test.ts`)
 * that exercise the lock-acquire / exit-handler contract in isolation,
 * without requiring the full `finalize()` entry point (which needs a real
 * worktree + GPG key + dev checkout).
 * knip: only reachable from the test's child-process fixture
 * (`finalize-lock-fixture.ts`, run via spawn — not a static import knip
 * can trace), plus one intra-file call knip doesn't track.
 */
export function acquireFinalizeLock(repoRoot: string): () => void {
  const lockPath = resolve(repoRoot, LOCK_FILENAME);
  const myPid = process.pid;

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(myPid));
      closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };

  const reapStale = (): boolean => {
    let lockRaw = "";
    try {
      lockRaw = readFileSync(lockPath, "utf8").trim();
    } catch {
      return false;
    }
    const ownerPid = parseInt(lockRaw, 10);
    if (!Number.isFinite(ownerPid)) {
      // Empty or corrupt lockfile: a previous holder died between create
      // and PID write (SIGKILL leaves a 0-byte file). Reap and retry.
      try {
        unlinkSync(lockPath);
      } catch { /* best-effort */ }
      return tryCreate();
    }
    if (ownerPid === myPid) return false;
    try {
      process.kill(ownerPid, 0);
      // Owner still alive — keep their lock.
      return false;
    } catch (err) {
      // Only reap on ESRCH (process truly gone). EPERM means we lack
      // permission to signal the owner — typical for non-root agents
      // checking PID 1 (init) — but the process IS alive, so respect
      // its lock. Other errors fall through to retry that will fail
      // safely if the owner is actually gone.
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") return false;
    }
    try {
      unlinkSync(lockPath);
    } catch { /* best-effort */ }
    return tryCreate();
  };

  const release = (): void => {
    try {
      unlinkSync(lockPath);
    } catch { /* best-effort */ }
  };

  for (let attempt = 0; attempt < 50; attempt++) {
    if (tryCreate()) return release;
    if (reapStale()) return release;
    // Brief backoff before retry. 50 × 20ms = 1s ceiling.
    Bun.sleepSync(20);
  }
  log("error", `could not acquire finalize lock at ${lockPath} — another finalize in progress?`);
  raw("  If no other finalize is running, remove the lockfile manually:");
  raw(`    rm ${lockPath}`);
  process.exit(1);
}

/**
 * Install SIGINT/SIGTERM/SIGHUP handlers that run a transactional rollback
 * when the user (or orchestrator) interrupts finalize mid-flight.
 *
 * The handler reads `ACTIVE_ABORT_STATE` to know what to roll back:
 *   - `mergeInProgress`: run `git merge --abort` to leave dev clean
 *   - `stashLabel`:      pop the stash back so the user's pre-merge work
 *                        is preserved (or stays on the stack if pop conflicts)
 *   - repoRoot/branch:   printed in the abort log so the user can recover
 *                        manually if anything in the rollback fails
 *
 * The handler is installed exactly once per finalize call. A refcount
 * (`ACTIVE_FINALIZE_COUNT`) ensures nested calls don't double-register or
 * prematurely tear down an outer call's state. After the rollback we exit
 * with code 130 (the convention for SIGINT-terminated processes) — the
 * orchestrator can distinguish signal-abort (130) from operator refusal (1).
 *
 * IMPORTANT: this function MUST be called after `acquireFinalizeLock` and
 * BEFORE any dev-checkout mutation. The companion `uninstallSignalHandlers`
 * runs in the success path of finalize to restore Node's default disposition.
 */
function installSignalHandlers(): void {
  if (ACTIVE_FINALIZE_COUNT === 0) {
    for (const sig of FINALIZE_SIGNALS) {
      // Node's signal listener accepts NodeJS.Signals; the union is closed
      // by FINALIZE_SIGNALS so the cast is total. We don't carry the
      // runtime signal number — the loop index already tells us which
      // signal was raised.
      const listener: NodeJS.SignalsListener = () => {
        handleSignalAbort(sig);
      };
      process.on(sig, listener);
    }
    // Catch-all cleanup: release the lock on every termination path
    // (`process.exit()`, unhandled throw, signal). Node fires the `exit`
    // event AFTER all signal handlers have run but BEFORE the process
    // actually terminates, so the lock release here runs even when the
    // operator-error paths in `runFinalize` call `process.exit(1)`
    // directly (which bypasses our outer try/finally).
    process.on("exit", releaseLockOnExit);
  }
  ACTIVE_FINALIZE_COUNT++;
}

/**
 * Counterpart to `installSignalHandlers`. Call exactly once per matching
 * install, in the success/error path of finalize, BEFORE releasing the lock.
 * Restoring the default disposition (rather than removing the listener) is
 * important because Node tracks listeners by reference; calling
 * `removeListener` with the exact closure is fragile if the function is
 * re-exported. Restoring the default also covers the case where the same
 * process later runs another command that doesn't want our handlers.
 */
function uninstallSignalHandlers(): void {
  ACTIVE_FINALIZE_COUNT = Math.max(0, ACTIVE_FINALIZE_COUNT - 1);
  if (ACTIVE_FINALIZE_COUNT === 0) {
    for (const sig of FINALIZE_SIGNALS) {
      // `removeAllListeners(sig)` removes every listener for that signal
      // and restores Node's default disposition. Safe because we only ever
      // add one listener per signal in installSignalHandlers above.
      process.removeAllListeners(sig);
    }
    // Drop the `exit` cleanup now that the outer finally has released the
    // lock. After this point no finalize is in flight, so a stale `exit`
    // listener would just call release() against a null
    // ACTIVE_LOCK_RELEASE (no-op).
    process.removeAllListeners("exit");
  }
}

/**
 * `exit` handler: release the finalize lock on every process termination
 * path. Fires synchronously before the process actually exits, after any
 * signal handlers and unhandled-throw propagation but before stdio is
 * closed. We MUST NOT call `process.exit()` from here (the `exit` event
 * fires exactly once — recursing would throw) and we MUST NOT throw (any
 * uncaught throw inside an `exit` handler terminates the process abruptly
 * with no further cleanup). release is idempotent (catches ENOENT) so a
 * double-release is harmless.
 */
function releaseLockOnExit(): void {
  const release = ACTIVE_LOCK_RELEASE;
  if (!release) return;
  // Clear the slot first so a synchronous release+exit cycle cannot
  // re-enter this handler with a stale closure (defensive — Node fires
  // `exit` exactly once, but defensive is cheap).
  ACTIVE_LOCK_RELEASE = null;
  try {
    release();
  } catch { /* best-effort; nothing useful we can do */ }
}
/**
 * Signal handler: transactional rollback + exit 130. Runs even if the
 * surrounding `try { await runFinalize(...) } finally { release() }` would
 * have run — we explicitly do NOT rely on that finally for two reasons:
 *
 *   1. Signal-triggered exit bypasses user JS code entirely. The first
 *      Ctrl-C makes Node run this handler; a SECOND Ctrl-C (or `kill -9`)
 *      bypasses it. Relying on `try/finally` for signal safety is unsafe.
 *
 *   2. The rollback order matters and must happen BEFORE lock release,
 *      otherwise another finalize could acquire the lock mid-rollback and
 *      find dev in a half-restored state.
 */
function handleSignalAbort(sig: FinalizeSignal): void {
  const state = ACTIVE_ABORT_STATE;
  log("warn", `Finalize aborted by ${sig} — rolling back`);
  if (state) {
    if (state.mergeInProgress) {
      log("info", `Aborting in-progress merge on ${state.branch}...`);
      const abort = Bun.spawnSync(
        ["git", "-C", state.repoRoot, "merge", "--abort"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (abort.exitCode === 0) {
        log("success", `merge --abort succeeded on ${state.branch}`);
      } else {
        log("warn", `merge --abort failed — manual cleanup may be required`);
        raw(`  Stderr: ${abort.stderr.toString().trim()}`);
      }
    }
    if (state.stashLabel) {
      log("info", `Restoring stash '${state.stashLabel}'...`);
      // Use the same restoreDevFromStash logic the success path uses, but
      // pass `state.mergeHead ?? state.repoRoot` as the recovery HEAD —
      // if no merge was in progress, we just want to pop the stash back
      // onto a clean tree (HEAD is fine).
      const fallbackHead = state.mergeHead ?? "HEAD";
      try {
        restoreDevFromStash(state.repoRoot, state.stashLabel, fallbackHead);
      } catch (err) {
        // restoreDevFromStash calls process.exit on unrecoverable errors;
        // we wrap defensively so a thrown JS error doesn't bypass our exit.
        log("warn", `stash restore errored: ${(err as Error).message}`);
      }
    }
    raw("");
    raw(`  Recovery commands if anything looks off:`);
    raw(`    cd ${state.repoRoot}`);
    if (state.mergeInProgress) {
      raw(`    git merge --abort          # clean dev if not already`);
    }
    if (state.stashLabel) {
      raw(`    git stash list             # find your pre-merge stash`);
    }
  } else {
    log("warn", "no in-progress merge or stash to roll back");
  }
  // Lock release is handled by the `process.on('exit')` cleanup installed
  // in installSignalHandlers — Node fires `exit` synchronously between
  // this handler returning and the process actually terminating, so the
  // release runs regardless of which termination path we took (signal,
  // process.exit, unhandled throw). We exit explicitly so any pending
  // timers can't keep us alive.
  process.exit(SIGNAL_EXIT_CODE);
}

/**
 * Mark/unmark the merge as in-progress. Centralizing the ACTIVE_ABORT_STATE
 * mutation here means the signal handler has exactly one source of truth —
 * every merge site updates this slot instead of scattering the logic.
 */
function setMergeInProgress(
  repoRoot: string,
  branch: string,
  mergeHead: string,
  stashLabel: string | null,
  inProgress: boolean,
): void {
  ACTIVE_ABORT_STATE = { stashLabel, mergeHead, mergeInProgress: inProgress, repoRoot, branch };
}

function findWorktree(branch: string, config: WorktreeConfig): string | null {
  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);
  if (existsSync(resolve(wtPath, ".git"))) return wtPath;
  return null;
}

function gpgMergeFlags(config: WorktreeConfig): string[] {
  if (!config.agentGpgKeyId) return [];
  const gpgCheck = Bun.spawnSync(
    ["gpg", "--list-secret-keys", config.agentGpgKeyId],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (gpgCheck.exitCode !== 0) return [];
  return [
    "-c",
    "commit.gpgsign=true",
    "-c",
    `user.signingkey=${config.agentGpgKeyId}`,
  ];
}

function branchToSquashMessage(branch: string): string {
  let type = "chore";
  let subject = branch;

  const match = branch.match(/^(feature|fix|refactor|perf|docs|test|chore)\//);
  if (match) {
    const matched = match[1]!;
    type = matched === "feature" ? "feat" : matched;
    subject = branch.slice(match[0].length);
  }

  subject = subject.replace(/-/g, " ");
  subject = subject.charAt(0).toUpperCase() + subject.slice(1);

  return `${type}: ${subject}`;
}

/**
 * Stash dirty working-tree state on `repoRoot` (the dev checkout) before
 * an in-place merge. Returns a label identifying the stash entry, or `null`
 * if the tree was already clean. The caller MUST call `restoreDirtyDev()`
 * with the same label after the merge completes — even on failure — to
 * avoid losing uncommitted work in the dev checkout.
 *
 * Why: `git merge --ff-only` refuses to proceed when the working tree has
 * uncommitted changes that overlap with the merge. This is the most common
 * cause of FF failure in finalize; auto-stashing makes the flow robust
 * against races where another agent or hook mutates dev mid-finalize.
 */
function stashDevForMerge(repoRoot: string): string | null {
  const dirty = Bun.spawnSync(
    ["git", "-C", repoRoot, "diff", "--quiet", "--ignore-submodules"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const staged = Bun.spawnSync(
    ["git", "-C", repoRoot, "diff", "--cached", "--quiet", "--ignore-submodules"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const untracked = Bun.spawnSync(
    ["git", "-C", repoRoot, "ls-files", "--others", "--exclude-standard"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const hasUntracked = untracked.stdout.toString().trim().length > 0;
  if (dirty.exitCode === 0 && staged.exitCode === 0 && !hasUntracked) {
    return null;
  }
  // Generate a distinguishable stash label so we can find it again even if
  // the user has unrelated stashes on the stack.
  const stashLabel = `${FINALIZE_STASH_PREFIX}${Date.now().toString(36)}`;
  const flags = hasUntracked ? ["--include-untracked"] : [];
  const stash = Bun.spawnSync(
    ["git", "-C", repoRoot, "stash", "push", ...flags, "-m", stashLabel],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (stash.exitCode !== 0) {
    log("error", `failed to stash dirty dev checkout: ${stash.stderr.toString().trim()}`);
    process.exit(1);
  }
  log("info", `Stashed dirty dev checkout as '${stashLabel}'`);
  return stashLabel;
}

/**
 * Restore the dev checkout from a stash entry created by `stashDevForMerge`,
 * with transactional semantics: if `git stash pop` conflicts with the
 * post-merge tree (the symptom from BUG-finalize-race where files end up
 * "modified" instead of cancelling cleanly), reset dev to the post-merge
 * HEAD so the tree is clean and the stash entry is preserved for manual
 * recovery.
 */
function restoreDevFromStash(
  repoRoot: string,
  stashLabel: string,
  mergeHead: string,
): void {
  // Find the stash ref by message; we can't rely on `stash@{0}` because
  // other agents may push stashes between our push and pop.
  const list = Bun.spawnSync(
    ["git", "-C", repoRoot, "stash", "list"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const lines = list.stdout.toString().split("\n");
  const match = lines.find((line) => line.includes(stashLabel));
  if (!match) {
    log("error", `stash '${stashLabel}' not found — restore manually with 'git stash list'`);
    process.exit(1);
  }
  const stashRef = match.split(":")[0]!.trim();
  const pop = Bun.spawnSync(
    ["git", "-C", repoRoot, "stash", "pop", stashRef],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (pop.exitCode === 0) {
    log("success", `Restored stash '${stashLabel}'`);
    return;
  }

  // Pop failed (conflict with post-merge tree). Roll dev back to the
  // post-merge HEAD so the checkout is clean and the stash entry is
  // preserved. Without this, files end up in "modified" state and the
  // user's pre-merge work disappears into the stash entry.
  log("warn", `stash pop conflicted — resetting dev to post-merge HEAD and preserving stash`);
  raw(`  Stash output: ${pop.stderr.toString().trim()}`);
  const reset = Bun.spawnSync(
    ["git", "-C", repoRoot, "reset", "--hard", mergeHead],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (reset.exitCode !== 0) {
    log("error", `failed to reset dev to ${mergeHead} after stash pop failure`);
    raw(`  Stderr: ${reset.stderr.toString().trim()}`);
    raw(`  Manual recovery:`);
    raw(`    cd ${repoRoot}`);
    raw(
      `    git reset --hard ${mergeHead}     # discard the merge (or 'git reset --hard HEAD~1' if you want to undo it)`,
    );
    raw(`    git stash pop ${stashRef}         # then apply your pre-merge work`);
    process.exit(1);
  }
  log("info", `Dev reset to ${mergeHead.slice(0, 8)}; stash entry '${stashRef}' preserved`);
  raw(`  Your pre-merge work is still on the stash stack as '${stashRef}'.`);
  raw(`  When ready: cd ${repoRoot} && git stash pop ${stashRef}`);
}
/**
 * Resolve the diff-base ref to pass to `bun run check --diff-base`.
 *
 * Why: the `--diff-base` arg scopes coverage + unit gates to that ref's
 * diff vs HEAD (see AGENTS.md). Passing the live target branch means
 * "branch vs current target", which leaks unrelated target-only changes
 * into the gate when the target has moved past the branch's base.
 *
 * This returns the merge-base of `target` and HEAD — a stable ancestor
 * that captures exactly what this branch has contributed since forking.
 *
 * Throws when `git merge-base` exits non-zero (target is not a valid ref
 * or has no common ancestor with HEAD). The previous implementation
 * silently returned `target` on failure, which then crashed
 * the target repo check runner downstream with a confusing stack trace.
 * Production callers always pass a valid `target` (the protected target
 * branch), so this throw is unreachable in normal finalize flows.
 *
 * Exported for unit tests; production callers in `runFinalize` invoke it.
 */
/**
 * Parse the CLI args for `worktree finalize`.
 *
 * Returns a structured object that the finalize() entry point consumes.
 * Exported for unit testing — production callers in `finalize()` invoke it.
 *
 * Validation:
 * - Unknown merge strategy: error log + process.exit(1) (immediate abort).
 *   We can't return an error cleanly here because the CLI surface uses
 *   process.exit directly; tests should mock process.exit if they want
 *   to exercise this branch.
 * - --gates and --skip-gates are mutually exclusive: same exit semantics.
 *
 * The returned values are forward-compatible with the bun.run check
 * CLI: `--gates <csv>` / `--skip-gates <csv>` are passed through to
 * the runner which validates the names itself.
 */
export function parseFinalizeArgs(args: string[]): {
  branch: string;
  mergeStrategy: string;
  force: boolean;
  gatesFilter: string;
  skipGatesFilter: string;
} {
  const nonFlagArgs: string[] = [];
  let mergeStrategy = "rebase";
  let force = false;
  let gatesFilter = "";
  let skipGatesFilter = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--merge-strategy") {
      const value = args[++i];
      if (value !== undefined) mergeStrategy = value;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--gates") {
      gatesFilter = args[++i] || "";
    } else if (arg === "--skip-gates") {
      skipGatesFilter = args[++i] || "";
    } else {
      nonFlagArgs.push(arg);
    }
  }
  if (gatesFilter && skipGatesFilter) {
    log("error", "--gates and --skip-gates are mutually exclusive");
    process.exit(1);
  }
  return {
    branch: nonFlagArgs[0] || "",
    mergeStrategy,
    force,
    gatesFilter,
    skipGatesFilter,
  };
}

export function resolveDiffBase(wtPath: string, target: string): string {
  const mergeBase = gitSyncQuiet(wtPath, "merge-base", target, "HEAD").trim();
  if (mergeBase.length === 0) {
    throw new Error(
      `git merge-base ${target} HEAD failed — target is not a valid ref `
        + `or has no common ancestor with HEAD. Cannot determine diff-base `
        + `for 'bun run check --diff-base'.`,
    );
  }
  return mergeBase;
}

function runCheck(
  wtPath: string,
  diffBase: string,
  extraCheckArgs: string[] = [],
  config?: WorktreeConfig,
  capturePath?: string,
): boolean {
  // The check command is user-configurable (settings.commands.check); the
  // diff-base flag is appended the same way the historical hard-coded
  // "bun run check" form was.
  const cmdWords = (config?.settings.commands.check ?? "bun run check").split(/\s+/);
  const result = Bun.spawnSync(
    [...cmdWords, "--diff-base", diffBase, ...extraCheckArgs],
    { stdout: "pipe", stderr: "pipe", cwd: wtPath },
  );
  if (capturePath) {
    try {
      writeFileSync(capturePath, result.stdout.toString() + result.stderr.toString());
    } catch { /* best-effort */ }
  }
  if (result.exitCode !== 0) {
    // Surface the runner's stderr so the operator can see WHICH gate
    // failed (or why, e.g. an unknown --gates name). Without this, a
    // user passing --gates='lint - eslint' on a failing gate would
    // just see "Checks failed" with no actionable context.
    const stderr = result.stderr.toString();
    if (stderr.length > 0) {
      process.stderr.write(stderr);
    }
  }
  return result.exitCode === 0;
}

function runTests(wtPath: string, config?: WorktreeConfig, capturePath?: string): boolean {
  const cmdWords = (config?.settings.commands.test ?? "bun run test:unit").split(/\s+/);
  const result = Bun.spawnSync(
    cmdWords,
    { stdout: "pipe", stderr: "pipe", cwd: wtPath },
  );
  if (capturePath) {
    try {
      writeFileSync(capturePath, result.stdout.toString() + result.stderr.toString());
    } catch { /* best-effort */ }
  }
  return result.exitCode === 0;
}

/**
 * Install the failure-gripe exit hook for one finalize run.
 *
 * Most finalize refusals exit via `process.exit(1)` deep inside
 * runFinalize, bypassing try/catch. The hook records a gripe for
 * exactly those paths; the thrown-error path records its own detailed
 * gripe (this hook is gone by then — uninstallSignalHandlers removes
 * all exit listeners). Only exit code 1 gripes: success (0) and signal
 * abort (130, covered by handleSignalAbort) stay quiet.
 * Best-effort: never throws (see appendLedger).
 *
 * Nested-finalize caveat: the `exit` event is process-wide, so an inner
 * run's `process.exit(1)` also fires an outer run's hook (one extra
 * gripe naming the outer branch). Only reachable from test fixtures —
 * real CLI runs never nest finalize.
 *
 * @param treeDir - shared tree directory holding the ledger
 * @param getBranch - reads the current branch hint at exit time
 */
function installFailureGripe(treeDir: string, getBranch: () => string): void {
  const gripeOnFail = (): void => {
    if (process.exitCode !== 1) return;
    const branch = getBranch();
    const target = branch === "" ? "?" : branch;
    appendGripe(treeDir, branch, `finalize ${target} failed (exit 1) — see console output`);
  };
  process.on("exit", gripeOnFail);
}

export async function finalize(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  let gripeBranch = "";
  installFailureGripe(config.treeDir, () => gripeBranch);
  // finalize is allowed from inside the worktree (e.g. while iterating on it):
  // the explicit branch arg identifies the target worktree, and loadConfig now
  // resolves repoRoot correctly via --git-common-dir regardless of cwd.
  let branch = "";
  let mergeStrategy = "rebase";
  let force = false;
  let gatesFilter = "";
  let skipGatesFilter = "";
  const parsed = parseFinalizeArgs(args);
  branch = parsed.branch;
  mergeStrategy = parsed.mergeStrategy;
  force = parsed.force;
  gatesFilter = parsed.gatesFilter;
  skipGatesFilter = parsed.skipGatesFilter;
  gripeBranch = branch;

  if (!["rebase", "squash", "direct"].includes(mergeStrategy)) {
    log("error", `unknown merge strategy '${mergeStrategy}' — use rebase, squash, or direct`);
    process.exit(1);
  }

  if (!branch) {
    log("error", "branch name required");
    raw(
      "  Usage: giwt finalize <branch> [--merge-strategy rebase|squash|direct] [--force] [--gates <csv>] [--skip-gates <csv>]",
    );
    process.exit(1);
  }

  // Resolve directory name to branch name
  const dirName = branchToPath(branch);
  const dirPath = resolve(config.treeDir, dirName);
  if (existsSync(resolve(dirPath, ".git"))) {
    const headRef = gitSync(dirPath, "symbolic-ref", "--short", "HEAD");
    if (headRef && headRef !== branch) {
      log("info", `Resolved '${branch}' → branch '${headRef}'`);
      branch = headRef;
      gripeBranch = branch;
    }
  }

  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot finalize protected branch '${branch}'`);
    process.exit(1);
  }

  const wtPath = findWorktree(branch, config);
  if (!wtPath) {
    log("error", `no worktree found for branch '${branch}'`);
    process.exit(1);
  }

  const targetBranch = getRootBranch(config.repoRoot);

  // Refuse concurrent or in-flight dev-checkout operations BEFORE doing
  // anything that mutates `repoRoot`. See BUG-finalize-race: two concurrent
  // finalizes race on stash push/pop around an in-place merge, which can leave
  // files in "modified" instead of cancelling cleanly. The precheck is the
  // hard invariant; the lock is best-effort single-flight.
  checkDevMergeable(config.repoRoot);
  const releaseFinalizeLock = acquireFinalizeLock(config.repoRoot);
  // Publish the release fn so the `process.on('exit')` cleanup (installed
  // by installSignalHandlers) can call it on every termination path —
  // including operator-error paths inside runFinalize that call
  // `process.exit(1)` directly and bypass the outer try/finally. The outer
  // finally still calls release() on the success/error path; release is
  // idempotent so the `exit` handler and the finally racing is harmless.
  ACTIVE_LOCK_RELEASE = releaseFinalizeLock;
  // Install signal handlers AFTER acquiring the lock. Order matters:
  // 1. lock first — so a signal can't race against an unlocked dev tree;
  // 2. handlers second — they release the lock during rollback.
  // Uninstall runs in `finally` BEFORE clearing the module-scoped release,
  // otherwise the handler could be invoked after the release fn is gone and
  // try to call a stale closure. The signal exit code (130) is propagated
  // by process.exit inside the handler, so the cleanup below only runs on
  // the happy / operator-error path.
  installSignalHandlers();
  try {
    try {
      await runFinalize(
        branch,
        mergeStrategy,
        force,
        gatesFilter,
        skipGatesFilter,
        config,
        wtPath,
        targetBranch,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      appendGripe(config.treeDir, branch, `finalize ${branch} failed: ${reason}`);
      throw error;
    } finally {
      uninstallSignalHandlers();
    }
  } finally {
    releaseFinalizeLock();
    ACTIVE_LOCK_RELEASE = null;
  }
}

async function runFinalize(
  branch: string,
  mergeStrategy: string,
  force: boolean,
  gatesFilter: string,
  skipGatesFilter: string,
  config: WorktreeConfig,
  wtPath: string,
  targetBranch: string,
): Promise<void> {
  section(`Finalizing '${branch}'`);
  // Shared-state view: what agents recorded lately, before mutating dev.
  printRecentLedger(config.treeDir, 10);
  // Step 1: Check worktree clean
  log("info", "Step 1: Checking worktree state...");
  const dirty = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--quiet"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const staged = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--cached", "--quiet"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
    log("error", "uncommitted changes detected — commit or stash before finalizing");
    raw(`  cd ${wtPath} && git add -A && git commit -m 'feat: ...'`);
    raw(`  cd ${wtPath} && git stash`);
    process.exit(1);
  }
  log("success", "Worktree clean");

  // Step 2: Run checks
  log("info", `Step 2: Running checks (${config.settings.commands.check})...`);
  if (force) {
    log("warn", "Skipped: --force flag set");
  } else {
    const checkArgs: string[] = [];
    if (gatesFilter) {
      checkArgs.push("--gates", gatesFilter);
    } else if (skipGatesFilter) {
      checkArgs.push("--skip-gates", skipGatesFilter);
    }
    const hasBunLock = existsSync(resolve(wtPath, "bun.lock"));
    if (hasBunLock) {
      // See resolveDiffBase for why we don't pass targetBranch directly.
      const diffBase = resolveDiffBase(wtPath, targetBranch);
      if (runCheck(wtPath, diffBase, checkArgs, config, activeRun()?.capturePath("check.log"))) {
        log("success", `Checks passed (diff-base=${diffBase.slice(0, 8)}…)`);
      } else {
        log("error", "Checks failed — fix before finalizing (or use --force)");
        process.exit(1);
      }
    } else {
      log("warn", "Skipped: no bun.lock found");
    }
  }

  // Step 3: Run tests
  log("info", `Step 3: Running tests (${config.settings.commands.test})...`);
  if (force) {
    log("warn", "Skipped: --force flag set");
  } else {
    const hasBunLock = existsSync(resolve(wtPath, "bun.lock"));
    if (hasBunLock && runTests(wtPath, config, activeRun()?.capturePath("test.log"))) {
      log("success", "Tests passed");
    } else if (!hasBunLock) {
      log("warn", "Skipped: no bun.lock found");
    } else {
      log("error", "Tests failed — fix before finalizing (or use --force)");
      process.exit(1);
    }
  }

  // Step 4: Check branch has commits beyond base
  log("info", "Step 4: Checking commits...");
  const aheadStr = gitSync(wtPath, "rev-list", "--count", `${targetBranch}..HEAD`);
  const ahead = parseInt(aheadStr || "0", 10);
  if (ahead === 0) {
    log("warn", `Branch '${branch}' has no commits beyond ${targetBranch} — nothing to merge`);
    process.exit(0);
  }
  log("success", `Branch has ${ahead} commit(s) beyond ${targetBranch}`);

  // Step 5: Merge
  if (mergeStrategy === "rebase" || mergeStrategy === "squash") {
    // 5a: Rebase
    log("info", `Step 5a: Rebasing '${branch}' onto ${targetBranch}...`);
    const rebaseResult = Bun.spawnSync(
      ["git", "-C", wtPath, "rebase", targetBranch],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (rebaseResult.exitCode !== 0) {
      log("error", `Rebase conflicts — resolve in ${wtPath}`);
      raw(`  Then: cd ${wtPath} && git rebase --continue`);
      raw(`  Then: finalize again`);
      raw(`  Or:   cd ${wtPath} && git rebase --abort`);
      process.exit(1);
    }
    log("success", "Rebased successfully");

    // 5b: Integrate
    if (mergeStrategy === "squash") {
      const msg = branchToSquashMessage(branch);
      log("info", `Step 5b: Squash merging into ${targetBranch}...`);
      // Gate: GPG must be configured AND unlocked before we produce a
      // squash commit. The previous `git merge --squash` invocation ran
      // without `-c commit.gpgsign=true`, producing an unsigned squash
      // commit even on a warm cache. Splicing gpgMergeFlags into the
      // command fixes that.
      assertAgentGpgUnlocked();
      const flags = gpgMergeFlags(config);
      const devStash = stashDevForMerge(config.repoRoot);
      const preMergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
      setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, true);
      try {
        const mergeResult = Bun.spawnSync(
          ["git", "-C", config.repoRoot, ...flags, "merge", branch, "--squash", "-m", msg],
          { stdout: "pipe", stderr: "pipe" },
        );
        if (mergeResult.exitCode !== 0) {
          log("error", "Squash merge failed");
          process.exit(1);
        }
        setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, false);
        log("success", `Squash merged: ${msg}`);
      } finally {
        if (devStash !== null) {
          const mergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
          restoreDevFromStash(config.repoRoot, devStash, mergeHead);
        }
      }
    } else {
      log("info", `Step 5b: Fast-forward merging into ${targetBranch}...`);
      const devStash = stashDevForMerge(config.repoRoot);
      let ffOk = false;
      const preMergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
      setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, true);
      try {
        const mergeResult = Bun.spawnSync(
          ["git", "-C", config.repoRoot, "merge", branch, "--ff-only"],
          { stdout: "pipe", stderr: "pipe" },
        );
        if (mergeResult.exitCode !== 0) {
          log("error", "Fast-forward merge failed");
          process.exit(1);
        }
        ffOk = true;
        setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, false);
        log("success", "Fast-forward merged");
      } finally {
        if (devStash !== null) {
          const mergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
          restoreDevFromStash(config.repoRoot, devStash, mergeHead);
        }
      }
      if (ffOk) { /* restored above */ }
    }
  } else if (mergeStrategy === "direct") {
    // Direct merge warning
    raw("");
    raw(colorize("╔════════════════════════════════════════════════════════════╗", "yellow"));
    raw(colorize("║  ⚠ WARNING: Direct merge strategy                        ║", "yellow"));
    raw(colorize("║                                                          ║", "yellow"));
    raw(colorize(`║  Conflicts will be resolved on ${targetBranch.padEnd(35)}║`, "yellow"));
    raw(colorize(`║  This can leave ${targetBranch.padEnd(35)} in a broken state.║`, "yellow"));
    raw(colorize("║                                                          ║", "yellow"));
    raw(colorize("║  Consider: --merge-strategy rebase                        ║", "yellow"));
    raw(colorize("╚════════════════════════════════════════════════════════════╝", "yellow"));
    raw("");

    if (!force) {
      log("error", "Aborted. Use --force to proceed with direct merge");
      process.exit(1);
    }
    // Gate: GPG must be configured AND unlocked before we attempt a signed
    // direct merge. The previous behavior let `gpgMergeFlags()` silently
    // return [] on cold cache, producing an unsigned merge commit.
    assertAgentGpgUnlocked();
    const flags = gpgMergeFlags(config);
    const devStash = stashDevForMerge(config.repoRoot);
    const preMergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
    setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, true);
    try {
      const mergeResult = Bun.spawnSync(
        ["git", "-C", config.repoRoot, ...flags, "merge", branch, "--no-edit"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (mergeResult.exitCode !== 0) {
        log("error", `Merge conflicts — resolve on ${targetBranch}`);
        process.exit(1);
      }
      setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, false);
      log("success", `Merged into ${targetBranch}`);
    } finally {
      if (devStash !== null) {
        const mergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
        restoreDevFromStash(config.repoRoot, devStash, mergeHead);
      }
    }

    // Verify GPG signature
    const mergeSha = gitSync(config.repoRoot, "rev-parse", "HEAD");
    const verifyResult = Bun.spawnSync(
      ["git", "-C", config.repoRoot, "verify-commit", mergeSha],
      { stdout: "pipe", stderr: "pipe" },
    );
    // Strict verify: assertAgentGpgUnlocked above already gates against
    // cold-cache. An unsigned merge here means the cold-cache gate was
    // bypassed (e.g. passphrase expired mid-merge) — fail loudly rather
    // than silently leaving an unsigned commit on the target branch.
    if (verifyResult.exitCode === 0) {
      log("success", `Merge commit GPG-signed (${mergeSha.slice(0, 8)})`);
    } else {
      log("error", `Merge commit ${mergeSha.slice(0, 8)} is unsigned — refusing to finalize`);
      process.exit(1);
    }
  }

  // Step 6: Remove worktree
  log("info", "Step 6: Removing worktree...");
  const removeResult = Bun.spawnSync(
    ["git", "worktree", "remove", wtPath, "--force"],
    { stdout: "pipe", stderr: "pipe", cwd: config.repoRoot },
  );
  if (removeResult.exitCode === 0) {
    log("success", "Worktree removed");
  } else {
    log("warn", `Failed to remove worktree — remove manually: git worktree remove ${wtPath}`);
  }

  // Step 7: Delete branch
  log("info", "Step 7: Deleting branch...");
  const deleteResult = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "branch", "-d", branch],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (deleteResult.exitCode === 0) {
    log("success", "Branch deleted");
  } else {
    // Force delete
    Bun.spawnSync(
      ["git", "-C", config.repoRoot, "branch", "-D", branch],
      { stdout: "pipe", stderr: "pipe" },
    );
    log("success", "Branch deleted (forced)");
  }

  raw("");
  log("success", `Finalized '${branch}' — merged to ${targetBranch}`);
}
