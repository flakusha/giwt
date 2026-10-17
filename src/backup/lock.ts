// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Backup-root lock: the shared PID-lock kit plus a held-lock report that
 * names the holder and the manual remedy. `giwt backup dump` is the only
 * writer; `verify` is read-only and never locks.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { log, raw } from "../utils/output";
import { acquirePidLock, formatLockAge, pidAlive } from "../utils/pid-lock";

export const LOCK_FILENAME = ".backup.lock";

/** Acquire the backup root lock, or throw with a holder report. */
export function acquireBackupLock(rootAbs: string): () => void {
  const lockPath = join(rootAbs, LOCK_FILENAME);
  const release = acquirePidLock(lockPath);
  if (release !== null) return release;
  reportHeldBackupLock(lockPath);
  throw new Error(
    `could not acquire backup lock at ${lockPath} — another backup run is in progress`,
  );
}

/** Holder report for a lock we could not acquire (output-only; caller exits). */
export function reportHeldBackupLock(lockPath: string): void {
  let holderPid: number | null = null;
  try {
    const parsed = parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    if (Number.isFinite(parsed)) holderPid = parsed;
  } catch {
    // Unreadable lockfile: reported below without a PID line.
  }
  log("error", `could not acquire backup lock at ${lockPath} — another backup run is in progress`);
  if (holderPid === null) {
    raw("  Lockfile is empty or unreadable — a previous run likely died mid-write.");
    return;
  }
  const alive = pidAlive(holderPid);
  let age = "unknown age";
  try {
    age = `lock age ${formatLockAge(Date.now() - statSync(lockPath).mtimeMs)}`;
  } catch {
    // Lockfile vanished between the last attempt and this report.
  }
  raw(`  Holder: PID ${holderPid} (${alive ? "alive" : "dead"}), ${age}`);
  if (!alive) {
    raw(`  Holder is dead, so this lock is stale; remove the lockfile: rm ${lockPath}`);
  }
}
