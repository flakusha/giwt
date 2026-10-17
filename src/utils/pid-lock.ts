// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared PID-lockfile kit: wx-create with PID write, stale-owner reaping,
 * full-jitter retry. Extracted from the finalize family (FEAT-backup L0
 * dump engine) so every long-running command locks with the exact same
 * semantics instead of growing a second dialect.
 */

import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

/** Retry budget for the full-jitter fast path: 50 attempts × ≤20ms = 1s. */
export const LOCK_RETRY_ATTEMPTS = 50;
/** Per-attempt full-jitter ceiling in ms. */
export const LOCK_RETRY_MAX_MS = 20;

/**
 * Full-jitter backoff draw for one failed lock attempt. Callers de-phase
 * instead of retrying in lockstep; the per-attempt ceiling is unchanged by
 * the jitter.
 */
export function lockRetryDelayMs(): number {
  return Math.floor(Math.random() * LOCK_RETRY_MAX_MS);
}

/**
 * True when `pid` refers to a live process (kill -0 semantics). EPERM
 * counts as alive: the process exists, we merely lack permission to
 * signal it — same policy as the stale-reap path.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Compact human duration for held-lock reports ("45s", "3m12s", "2h05m"). */
export function formatLockAge(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/**
 * One lock attempt against `lockPath`: create-exclusive + PID write; when
 * the file exists, reap a provably-dead owner (or a corrupt 0-byte remnant
 * of a SIGKILLed holder) and try once more. Returns the release function,
 * or null when the lock is (still) held by a live process.
 */
export function tryPidLock(
  lockPath: string,
  myPid: number = process.pid,
): (() => void) | null {
  const release = (): void => {
    try {
      unlinkSync(lockPath);
    } catch { /* best-effort */ }
  };

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
      // its lock.
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") return false;
    }
    try {
      unlinkSync(lockPath);
    } catch { /* best-effort */ }
    return tryCreate();
  };

  if (tryCreate()) return release;
  if (reapStale()) return release;
  return null;
}

/**
 * Bounded full-jitter acquire loop (fast path only). Returns the release
 * function, or null once the retry budget is exhausted — the caller owns
 * the held-lock report (finalize queues FIFO; simpler commands fail with
 * a remedy naming the lockfile).
 */
export function acquirePidLock(
  lockPath: string,
  attempts: number = LOCK_RETRY_ATTEMPTS,
): (() => void) | null {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const release = tryPidLock(lockPath);
    if (release !== null) return release;
    Bun.sleepSync(lockRetryDelayMs());
  }
  return null;
}
