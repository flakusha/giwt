// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { readFileSync, statSync } from "node:fs";
import { log, raw } from "../../utils/output";

/**
 * True when `pid` refers to a live process (kill -0 semantics). EPERM
 * counts as alive: the process exists, we merely lack permission to
 * signal it — same policy as the stale-reap path above.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Compact human duration for the held-lock report ("45s", "3m12s", "2h05m"). */
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
 * Report a finalize lock we could not acquire, with everything an operator
 * (or agent) needs to decide without leaving the terminal: lock path,
 * holder PID, alive/dead, lock age, and the `giwt abort` recovery command.
 * Ticket FIX-errors-carry-no-remedy: the old message was just "could not
 * acquire lock", forcing manual lockfile stat + PID checks. Output-only
 * (no exit) so tests can assert the report; the caller exits.
 */
export function reportHeldLock(lockPath: string, now: number = Date.now()): void {
  let holderPid: number | null = null;
  try {
    const parsed = parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    if (Number.isFinite(parsed)) holderPid = parsed;
  } catch {
    // Empty/unreadable lockfile: reported below without a PID line.
  }
  let ageMs: number | null = null;
  try {
    ageMs = now - statSync(lockPath).mtimeMs;
  } catch {
    // Lockfile vanished between the last acquire attempt and this report.
  }
  log("error", `could not acquire finalize lock at ${lockPath} — another finalize is in progress`);
  if (holderPid === null) {
    raw(
      "  Lockfile is empty or unreadable — a previous run likely died between creating the lock and writing its PID.",
    );
  } else {
    const alive = pidAlive(holderPid);
    const age = ageMs === null ? "unknown" : formatLockAge(ageMs);
    raw(`  Holder: PID ${holderPid} (${alive ? "alive" : "dead"}), lock age ${age}`);
    if (!alive) {
      raw(
        `  Holder is dead, so this lock is stale; if 'giwt abort' does not clear it, remove the lockfile: rm ${lockPath}`,
      );
    }
  }
  raw("  Recovery: run 'giwt abort' — it rolls back the in-progress merge and releases the lock.");
}
