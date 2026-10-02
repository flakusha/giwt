// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// ── Fix-mode lock (serializes concurrent --fix runs) ───────────

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/output";

export function isLockStale(lockPath: string): boolean {
  let ageMs = Number.POSITIVE_INFINITY;
  try {
    const pid = parseInt(readFileSync(join(lockPath, "owner.pid"), "utf8").trim(), 10);
    if (!Number.isInteger(pid)) return true;
    try {
      process.kill(pid, 0); // signal 0 = liveness probe, no signal delivered
      return false; // owner alive — lock genuinely held
    } catch (e) {
      // EPERM: process exists but is not ours → alive, do not break.
      return (e as NodeJS.ErrnoException).code !== "EPERM";
    }
  } catch {
    // No readable pid: the owner may be inside the mkdir→writeFileSync
    // window — a fresh lock counts as held; an aged or vanished one is
    // stale (ageMs stays Infinity when the lock is already gone).
    try {
      ageMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      // lock vanished — nothing alive claims it
    }
  }
  return ageMs > 5_000;
}

export function acquireFixLock(lockPath: string): boolean {
  // mkdir is the atomic test-and-set — no existsSync→mkdir TOCTOU window.
  try {
    mkdirSync(lockPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST" || !isLockStale(lockPath)) {
      log(
        "error",
        String(`Another index sync is in progress (lock: ${lockPath}).`).replace(/\n$/, ""),
      );
      return false;
    }
    rmSync(lockPath, { recursive: true, force: true });
    log(
      "warn",
      String("Removed stale index-sync lock left by a dead process").replace(/\n$/, ""),
    );
    // Losing the reclaim race twice in a row is beyond mitigation — let
    // the error propagate; the dispatcher exits non-zero.
    mkdirSync(lockPath);
  }
  writeFileSync(join(lockPath, "owner.pid"), `${process.pid}\n`);
  return true;
}

export function releaseFixLock(lockPath: string): void {
  try {
    rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // already gone — nothing to release
  }
}
