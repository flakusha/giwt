// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the held-lock error report of `giwt worktree finalize`.
 *
 * Regression target (ticket FIX-errors-carry-no-remedy): the old error was
 * "could not acquire lock" with no PID, no age, no liveness, and no `giwt
 * abort` hint — the reporter had to stat the lockfile and check the PID by
 * hand. The fix prints lock path, holder PID, alive/dead, lock age, and
 * the recovery command.
 *
 * Strategy: drive the exported `reportHeldLock()` directly against real
 * lockfiles in /tmp — a dead holder (a reaped child PID), an alive holder
 * (this test process), and an empty (crashed) lockfile.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportHeldLock } from "./finalize";

function capture(fn: () => void): string {
  const outSpy = spyOn(process.stdout, "write");
  const errSpy = spyOn(process.stderr, "write");
  outSpy.mockImplementation(() => true);
  errSpy.mockImplementation(() => true);
  let all = "";
  try {
    fn();
  } finally {
    all = [
      ...outSpy.mock.calls.map((args) => String(args[0])),
      ...errSpy.mock.calls.map((args) => String(args[0])),
    ].join("");
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return all;
}

/** A PID that is definitely not running: a child that already exited. */
function reapedPid(): number {
  const proc = Bun.spawnSync(["true"]);
  return proc.pid;
}

describe("reportHeldLock (FIX-errors-carry-no-remedy)", () => {
  test("dead holder: prints path, PID, dead, age, and the abort recovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-lock-dead-"));
    try {
      const lockPath = join(dir, ".worktree-finalize.lock");
      writeFileSync(lockPath, String(reapedPid()));
      const out = capture(() => reportHeldLock(lockPath));
      expect(out).toContain(lockPath);
      expect(out).toContain("could not acquire finalize lock");
      expect(out).toMatch(/PID \d+/);
      expect(out).toContain("dead");
      expect(out).toContain("lock age ");
      expect(out).toContain("giwt abort");
      // Stale-lock extra: the manual removal escape hatch names the path.
      expect(out).toContain(`rm ${lockPath}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("alive holder: prints PID and alive, no manual-removal hint", () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-lock-alive-"));
    try {
      const lockPath = join(dir, ".worktree-finalize.lock");
      writeFileSync(lockPath, String(process.pid));
      const out = capture(() => reportHeldLock(lockPath));
      expect(out).toContain(lockPath);
      expect(out).toContain(`PID ${process.pid} (alive)`);
      expect(out).toContain("giwt abort");
      expect(out).not.toContain("rm ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty lockfile (crashed run): still names path and recovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-lock-empty-"));
    try {
      const lockPath = join(dir, ".worktree-finalize.lock");
      writeFileSync(lockPath, "");
      const out = capture(() => reportHeldLock(lockPath));
      expect(out).toContain(lockPath);
      expect(out).toContain("empty or unreadable");
      expect(out).toContain("giwt abort");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
