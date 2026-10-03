// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
/**
 * Cross-process lock for ledger mutations (appendLedger / finishRecord).
 *
 * The ledger is a shared "agent chat" file under one treeDir, written by
 * many concurrent giwt invocations. Both writers are read-modify-write, so
 * without mutual exclusion two runs read the same N lines and each writes
 * back N+1 — the first writer's record is silently lost. The lock is the
 * check-slots trick narrowed to one holder: mkdir is atomic, the holder
 * wins, everyone else polls. Release is an idempotent rmdir, so a
 * SIGKILLed holder leaves at most a bounded-wait fallback (never a
 * permanently stuck ledger): the waiter proceeds unguarded rather than
 * wedge the file.
 *
 * Every caller wraps its whole read-modify-write in the callback, so the
 * seq = last+1 computation and the write happen under the same critical
 * section. Locking is best-effort like the ledger itself: any lock-mechanism
 * failure (unwritable treeDir, permission error) degrades to running the
 * callback directly — the ledger must never fail the command.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Lock dir next to the ledger file (same treeDir, same lifecycle). */
const LOCK_DIRNAME = ".ledger.lock";

/** Total wait before a waiter proceeds unguarded (stale-holder fallback).
 * Long enough to serialize real appends (~ms each), short enough that a
 * crashed holder never wedges a command for long. */
const LOCK_WAIT_MS = 2_000;

/** Poll cadence bounds (ms); jitter de-phases concurrent waiters. */
const POLL_MIN_MS = 5;
const POLL_MAX_MS = 25;

/**
 * Run `fn` while holding the treeDir's ledger lock. Bounded retry, then
 * proceed unguarded (liveness over strictness — matches the best-effort
 * ledger contract). Returns fn's result; never throws on lock trouble.
 */
export function withLedgerLock<T>(treeDir: string, fn: () => T): T {
  const lockPath = join(treeDir, LOCK_DIRNAME);
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        mkdirSync(lockPath);
        break; // holder
      } catch {
        // EEXIST or hostile tree: held by another writer (or unusable).
      }
      if (Date.now() >= deadline) return fn(); // stale holder: proceed
      Bun.sleepSync(POLL_MIN_MS + Math.floor(Math.random() * (POLL_MAX_MS - POLL_MIN_MS)));
    }
    try {
      return fn();
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  } catch {
    // Lock mechanism itself failed (e.g. treeDir vanished mid-run):
    // best-effort ledger, run the mutation unguarded.
    return fn();
  }
}
