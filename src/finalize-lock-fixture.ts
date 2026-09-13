// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Fixture for `finalize-lock-cleanup.test.ts`. Runs in a child process
 * so `process.exit` and signals really terminate it. Receives a tmp dir
 * and an exit mode as argv, exercises one of three paths through the
 * finalize lock machinery, then reports whether the lockfile still
 * exists at the moment of exit.
 *
 * We do NOT call the real `finalize()` entry point — that requires a
 * full worktree + GPG key + dev checkout, which is integration territory.
 * Instead we directly exercise `acquireFinalizeLock` and the
 * `process.on('exit')` cleanup contract that `installSignalHandlers`
 * sets up in production.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { LOCK_FILENAME } from "./commands/abort";
import { acquireFinalizeLock } from "./commands/finalize";
import { log, raw } from "./utils/output";

const tmp = process.argv[2]!;
const mode = process.argv[3]!;
const lockPath = join(tmp, LOCK_FILENAME);

const release = acquireFinalizeLock(tmp);

// Install the same cleanup `installSignalHandlers` would install in
// production: `process.on('exit')` runs synchronously between any
// termination request (process.exit, signal) and the process actually
// dying, so it covers all the operator-error paths the test wants to
// verify.
process.on("exit", () => {
  try {
    release();
  } catch { /* best-effort */ }
  if (existsSync(lockPath)) {
    raw("LEAK");
  } else {
    raw("OK");
  }
});
if (mode === "signal") {
  // Signal-triggered exit: install a handler that exits. The
  // production code does rollback work first; we skip that here
  // because the test is about the cleanup contract. Print a marker
  // first so the test can synchronize on it without timers.
  process.on("SIGHUP", () => {
    process.exit(130);
  });
  raw("started");
  // Block until the parent signals us. `setInterval` keeps the event
  // loop alive and never fires the timer callback, so control stays
  // here for the lifetime of the process. Return BEFORE any code that
  // could fall through to the unknown-mode branch below.
  setInterval(() => {}, 1000);
} else if (mode === "exit") {
  // Operator-error path: any `process.exit(1)` call inside runFinalize
  // helpers (stashDevForMerge, restoreDevFromStash, etc.) takes this
  // route. Before the fix this leaked the lock because `process.exit`
  // aborts the call stack before the outer finally runs.
  process.exit(1);
} else if (mode === "normal") {
  // Happy path: the outer finally would release the lock and clear
  // state. We mimic it inline so the `exit` handler still fires the
  // marker check.
  release();
  process.exit(0);
} else {
  log("error", String(`unknown mode: ${mode}`).replace(/\n$/, ""));
  process.exit(2);
}
