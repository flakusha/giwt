// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

import { isolatedGitEnv } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { restoreDevFromStash } from "./merge";

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
// Same publication pattern as the lock release, for the Step-2 check-fanout
// slot: published the moment a slot is held so the `process.on('exit')`
// cleanup (releaseLockOnExit) can free it on every termination path. Null
// whenever no slot is held (--force, no bun.lock, contention timeout).
let ACTIVE_CHECK_SLOT_RELEASE: (() => void) | null = null;
/**
 * Publish/clear the module-scoped lock release. Replaces the old direct
 * module-global assignment (imports are read-only in TypeScript).
 */
export function publishActiveLockRelease(release: (() => void) | null): void {
  ACTIVE_LOCK_RELEASE = release;
}
/**
 * Publish/clear the module-scoped check-fanout slot release. Same seam as
 * `publishActiveLockRelease` for the Step-2 slot.
 */
export function publishActiveCheckSlotRelease(release: (() => void) | null): void {
  ACTIVE_CHECK_SLOT_RELEASE = release;
}
/**
 * Release the Step-2 check-fanout slot, if one is held. The `exit` hook and
 * runFinalize's finally MUST stay in lockstep through this helper: clear the
 * global first (so a re-entrant call sees no slot), then release, swallowing
 * errors — release is idempotent (rmSync force), so a double call is safe.
 */
export function releaseActiveCheckSlot(): void {
  const releaseSlot = ACTIVE_CHECK_SLOT_RELEASE;
  if (!releaseSlot) return;
  ACTIVE_CHECK_SLOT_RELEASE = null;
  try {
    releaseSlot();
  } catch { /* best-effort; nothing useful we can do */ }
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
export function installSignalHandlers(): void {
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
export function uninstallSignalHandlers(): void {
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
  // Free the check-fanout slot first (cheap rmdir) so a slot can never
  // outlive the process that held it.
  releaseActiveCheckSlot();
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
      const abort = Bun.spawnSync(["git", "-C", state.repoRoot, "merge", "--abort"], {
        env: isolatedGitEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });
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
export function setMergeInProgress(
  repoRoot: string,
  branch: string,
  mergeHead: string,
  stashLabel: string | null,
  inProgress: boolean,
): void {
  ACTIVE_ABORT_STATE = { stashLabel, mergeHead, mergeInProgress: inProgress, repoRoot, branch };
}
