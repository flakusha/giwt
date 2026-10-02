// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Manual recovery command for a finalize that left the dev checkout in a
 * bad state — for example, a `kill -9` (SIGKILL) that bypassed the signal
 * handler, or a crash between the stash push and the merge.
 *
 * What it does, in order:
 *
 *   1. Detect in-progress git operations on the dev checkout (MERGE_HEAD,
 *      REBASE_HEAD, CHERRY_PICK_HEAD) and abort each.
 *   2. Pop any leftover `worktree-finalize-*` stash entries — these are
 *      auto-pushed by `stashDevForMerge` before every merge. Selection is
 *      anchored to the whole run label (not a message substring), pops run
 *      highest-index-first with per-pop label re-resolution, and a failed
 *      pop STOPS the recovery: the stash is preserved, the tree is never
 *      reset (an unscoped `reset --hard` would destroy unrelated tracked
 *      work in the shared dev checkout), and abort exits non-zero.
 *   3. Remove the finalize lockfile if present.
 *   4. Print a recovery report so the user can verify the state.
 *
 * Usage:
 *   giwt abort              # recover the dev checkout
 *   giwt abort --dry-run   # report only, no mutations
 *
 * Design notes:
 * - Idempotent. Running it twice in a row does the same thing.
 * - Never deletes user-authored stashes. We only touch entries whose entire
 *   message is a finalize run label (`worktree-finalize-<token>`); a stash
 *   that merely mentions the prefix is reported and left untouched.
 * - Never runs `reset --hard`: a failed stash pop leaves the tree as-is
 *   and surfaces the conflict instead of discarding tracked work.
 * - Never force-deletes branches, never resets to a remote ref, never
 *   touches the worktree under `tree/`. The user owns those decisions.
 *
 * Testability:
 * - The pure helpers (lockfile scan / remove, stash list parsing) take an
 *   injectable file-system so unit tests can drive them without touching
 *   real repo state. Parallel-safe by construction: each call resolves
 *   files relative to the `repoRoot` argument and reads them via the
 *   injected `readFile` / `unlink` callbacks — no module-level mutable
 *   state, no shared temp dir.
 * - The full `abort` orchestrator still calls `git` via spawnSync and
 *   therefore must run against a real git repo (one per test fixture).
 */
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "path";
import { type WorktreeConfig } from "../utils/config";
import { gitSync, gitSyncQuiet, isolatedGitEnv } from "../utils/git";
import { log, raw, section } from "../utils/output";
import {
  DEV_IN_PROGRESS_HEADS,
  FINALIZE_STASH_PREFIX,
  IN_PROGRESS_ABORT_COMMAND,
  isOrphanRebaseMarker,
  LOCK_FILENAME,
  parseStashList,
  removeLockfile,
  scanLockfile,
  selectFinalizeStashes,
  stashIndex,
} from "./abort/helpers";

export {
  DEV_IN_PROGRESS_HEADS,
  FINALIZE_STASH_PREFIX,
  type FsOps,
  isOrphanRebaseMarker,
  LOCK_FILENAME,
  type LockfileScan,
  parseStashList,
  removeLockfile,
  scanLockfile,
  selectFinalizeStashes,
  type StashEntry,
} from "./abort/helpers";

export async function abort(
  _args: string[],
  config: WorktreeConfig,
): Promise<void> {
  section("Finalize abort (manual recovery)");
  const dryRun = _args.includes("--dry-run");
  if (dryRun) log("warn", "DRY RUN: no mutations will be performed");
  const repoRoot = config.repoRoot;

  const gitDirRaw = gitSyncQuiet(repoRoot, "rev-parse", "--git-dir");
  const gitDirAbs = resolve(repoRoot, gitDirRaw.startsWith("/") ? gitDirRaw.slice(1) : gitDirRaw);

  // 1. Abort in-progress operations.
  for (const name of DEV_IN_PROGRESS_HEADS) {
    if (!existsSync(resolve(gitDirAbs, name))) continue;
    if (name === "REBASE_HEAD" && isOrphanRebaseMarker(gitDirAbs)) {
      // Orphan breadcrumb: the rebase already concluded (git's own state
      // dirs are gone) but the marker survived. `git rebase --abort`
      // errors in this state — remove the marker instead.
      log(
        "info",
        "Found orphan REBASE_HEAD (no rebase-merge/rebase-apply dirs) — removing stale marker",
      );
      if (!dryRun) {
        try {
          unlinkSync(resolve(gitDirAbs, name));
          log("success", "removed orphan rebase marker");
        } catch {
          log("warn", "could not remove orphan REBASE_HEAD — remove it manually");
        }
      }
      continue;
    }
    const op = IN_PROGRESS_ABORT_COMMAND[name];
    log("info", `Found ${name} — aborting in-progress ${op}...`);
    if (dryRun) continue;
    const result = Bun.spawnSync(
      ["git", "-C", repoRoot, op, "--abort"],
      { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
    );
    if (result.exitCode === 0) {
      log("success", `aborted in-progress ${op}`);
    } else {
      log("warn", `${op} --abort failed — you may need manual intervention`);
      raw(`  Stderr: ${result.stderr.toString().trim()}`);
    }
  }

  // 2. Pop leftover finalize stashes. Selection is shape-anchored (the
  // whole message after the branch context must be a finalize run label),
  // so a user stash that merely mentions the prefix is never touched.
  const stashEntries = parseStashList(gitSync(repoRoot, "stash", "list") ?? "");
  const finalizeStashes = selectFinalizeStashes(stashEntries);
  for (const entry of stashEntries) {
    if (finalizeStashes.includes(entry)) continue;
    if (!entry.message.includes(FINALIZE_STASH_PREFIX)) continue;
    log(
      "warn",
      `${entry.ref} mentions '${FINALIZE_STASH_PREFIX}' but is not a finalize-run label — left untouched`,
    );
    raw(`  Inspect: git stash show -p ${entry.ref}`);
  }
  let stashConflict = false;
  if (finalizeStashes.length === 0) {
    log("info", "No leftover finalize stashes");
  } else {
    log("info", `Found ${finalizeStashes.length} finalize stash(es)`);
    // Pop the highest index first: `stash pop` renumbers every lower
    // index, so a captured positional ref goes stale after each success
    // (BUG-abort-pops-stashes-by-positional-ref…: pops destroyed user
    // stashes while skipping the intended entry). Refs are ALSO
    // re-resolved by label before every pop, so concurrent pushes from
    // other agents cannot misroute one.
    const ordered = [...finalizeStashes].sort((a, b) => stashIndex(b) - stashIndex(a));
    for (const entry of ordered) {
      log("info", `Restoring ${entry.ref}...`);
      // Re-resolve: the index may have shifted since the scan (dry-run
      // included — the preview must show the same live refs).
      const live = parseStashList(gitSync(repoRoot, "stash", "list") ?? "").find(
        (e) => e.message === entry.message,
      );
      if (!live) {
        log("warn", `${entry.ref} is no longer on the stash stack — skipped`);
        continue;
      }
      // Clean = no dirt except our own lockfile (untracked in fixtures
      // without the .gitignore that real finalize checkouts carry).
      const dirtyLines = gitSyncQuiet(repoRoot, "status", "--porcelain")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l !== `?? ${LOCK_FILENAME}`);
      const cleanTree = dirtyLines.length === 0;
      if (cleanTree) {
        log(
          "warn",
          `${live.ref} applies onto a CLEAN tree — popping applies the whole snapshot and drops the entry`,
        );
        raw(`  If unexpected: abort now and inspect first ('git stash show -p ${live.ref}')`);
      }
      if (dryRun) continue;
      const pop = Bun.spawnSync(
        ["git", "-C", repoRoot, "stash", "pop", live.ref],
        { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
      );
      if (pop.exitCode === 0) {
        if (cleanTree) {
          // The entry is gone; keep the dropped sha so the operator can
          // undo a misdirected restore (`stash apply` accepts the sha).
          const dropped = pop.stdout.toString().match(/Dropped \S+ \(([0-9a-f]+)\)/);
          if (dropped) {
            raw(
              `  Dropped at ${dropped[1]} — undo with 'git stash apply ${
                dropped[1]
              }' if this was wrong`,
            );
          }
        }
        log("success", `restored ${live.ref}`);
        continue;
      }
      // Pop refused or conflicted; git preserved the stash entry. NEVER
      // hard-reset the tree here: an unscoped `reset --hard` destroys
      // every unrelated tracked modification and staged file in the
      // shared dev checkout (BUG-abort-hard-resets-dev…). Stop the
      // recovery and leave the decision to the operator.
      stashConflict = true;
      log("warn", `${live.ref} pop failed — stash preserved, tree left untouched (no reset)`);
      raw(`  Stderr: ${pop.stderr.toString().trim()}`);
      const unmerged = gitSyncQuiet(repoRoot, "diff", "--name-only", "--diff-filter=U");
      const paths = unmerged.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      if (paths.length > 0) {
        raw("  Conflicted paths (resolve or discard, then re-run 'giwt abort'):");
        for (const path of paths) raw(`    ${path}`);
      }
      raw(`  Inspect:  git -C ${repoRoot} stash show -p ${live.ref}`);
      break;
    }
  }

  // 3. Remove lockfile if present. Use the pure helper so the path is
  // computed identically to scanLockfile — no chance of drift.
  const lockScan = scanLockfile(repoRoot);
  if (lockScan.present) {
    log("info", `Found lockfile at ${lockScan.path} (owner PID ${lockScan.owner})`);
    if (!dryRun) {
      const removed = removeLockfile(repoRoot);
      if (removed) {
        log("success", "lockfile removed");
      } else {
        log("warn", `could not remove lockfile`);
      }
    }
  } else {
    log("info", "No lockfile present");
  }

  // 4. Final state report.
  raw("");
  log("info", "Final dev checkout state:");
  const head = gitSyncQuiet(repoRoot, "rev-parse", "--short", "HEAD");
  const branch = gitSyncQuiet(repoRoot, "branch", "--show-current") || "(detached)";
  raw(`  HEAD:   ${head}`);
  raw(`  Branch: ${branch}`);
  raw(`  Status: ${gitSyncQuiet(repoRoot, "status", "--porcelain") || "(clean)"}`);

  if (dryRun) {
    raw("");
    log("warn", "DRY RUN complete — no mutations performed. Re-run without --dry-run to apply.");
  } else if (stashConflict) {
    raw("");
    log("error", "Abort stopped early — stash recovery needs manual resolution (see above).");
    process.exit(1);
  } else {
    raw("");
    log("success", "Abort complete. Verify state, then re-run finalize if needed.");
  }
}
