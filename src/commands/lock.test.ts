// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the advisory `giwt lock` command (FEAT-advisory-giwt-lock-
 * status-command): held/free reporting, queue depth, --json shape, and
 * the read-only guarantee (no lock/slot state created or mutated).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { LOCK_FILENAME } from "./abort/helpers";
import { collectLockReport, lock } from "./lock";

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function fixture(): { root: string; slotDir: string; } {
  const root = join("/tmp", `giwt-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const slotDir = join(root, "check-slots");
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return { root, slotDir };
}

function cfg(root: string, memoryBudgetMb = 0): WorktreeConfig {
  return {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: root,
    settings: { doctor: { memoryBudgetMb } },
  } as unknown as WorktreeConfig;
}

function capture(): { out: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  return {
    out: () => chunks.join(""),
    restore: () => {
      process.stdout.write = orig as typeof process.stdout.write;
    },
  };
}

describe("collectLockReport", () => {
  it("reports free/idle with no lock and no slots", () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      const report = collectLockReport(cfg(root), 1_000_000);
      expect(report.finalize).toBe("free");
      expect(report.queueDepth).toBe(0);
      expect(report.checkSlotsUsed).toBe(0);
      expect(report.checkSlotsCapacity).toBeGreaterThanOrEqual(1);
      expect(report.holderPid).toBeUndefined();
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("reports held + holder + age + queue depth for a live-PID fixture lock", () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      writeFileSync(join(root, LOCK_FILENAME), `${process.pid}\n`);
      const queueDir = join(root, `${LOCK_FILENAME}.queue`);
      mkdirSync(queueDir);
      mkdirSync(join(queueDir, "000001-999"));
      mkdirSync(join(queueDir, "000002-998"));
      mkdirSync(join(slotDir, "0"), { recursive: true });
      const report = collectLockReport(cfg(root), Date.now());
      expect(report.finalize).toBe("held");
      expect(report.holderPid).toBe(process.pid);
      expect(report.holderAlive).toBe(true);
      expect(report.holderAge).toBeDefined();
      expect(report.queueDepth).toBe(2);
      expect(report.checkSlotsUsed).toBe(1);
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("flags a dead holder as not alive", () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      // PID 2^22-ish is unlikely to exist; ESRCH ⇒ dead.
      writeFileSync(join(root, LOCK_FILENAME), "2147483000\n");
      const report = collectLockReport(cfg(root), Date.now());
      expect(report.holderAlive).toBe(false);
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });
});

describe("giwt lock command", () => {
  it("prints human lines and the outcome; --json renders the same facts", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      writeFileSync(join(root, LOCK_FILENAME), `${process.pid}\n`);
      const cap = capture();
      try {
        await lock([], cfg(root, 8192));
        const out = cap.out();
        expect(out).toContain("finalize: held");
        expect(out).toContain(`holder: PID ${process.pid} (alive)`);
        expect(out).toContain("check-slots: 0/2 used");
        expect(out).toContain("ok ? finalize held");
      } finally {
        cap.restore();
      }
      const cap2 = capture();
      try {
        await lock(["--json"], cfg(root, 8192));
        const payload = JSON.parse(cap2.out());
        expect(payload.finalize).toBe("held");
        expect(payload.checkSlotsCapacity).toBe(2);
      } finally {
        cap2.restore();
      }
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("is read-only: creates/mutates no lock or slot state", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      const cap = capture();
      try {
        await lock([], cfg(root));
      } finally {
        cap.restore();
      }
      expect(existsSync(join(root, LOCK_FILENAME))).toBe(false);
      expect(existsSync(slotDir)).toBe(false);
      // And a held fixture is untouched.
      writeFileSync(join(root, LOCK_FILENAME), `${process.pid}\n`);
      const before = readdirSync(root).sort().join(",");
      const cap2 = capture();
      try {
        await lock(["--json"], cfg(root));
      } finally {
        cap2.restore();
      }
      expect(readdirSync(root).sort().join(",")).toBe(before);
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("help documents the advisory, gates-nothing nature", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      const cap = capture();
      try {
        await lock(["--help"], cfg(root));
        expect(cap.out()).toContain("gates nothing");
        expect(cap.out()).toContain("Read-only");
      } finally {
        cap.restore();
      }
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("rejects an unknown flag with usage + exit 1", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    const errChunks: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      errChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const origExit = process.exit;
    const codes: (number | undefined)[] = [];
    process.exit = ((code?: number) => {
      codes.push(code);
      throw new Error(`__exit:${code}`);
    }) as never;
    const cap = capture();
    try {
      await expect(lock(["--bogus"], cfg(root))).rejects.toThrow("__exit:1");
      expect(codes).toEqual([1]);
      expect(errChunks.join("")).toContain("unknown flag '--bogus'");
      expect(cap.out()).toContain("Usage: giwt lock");
    } finally {
      process.exit = origExit;
      process.stderr.write = origErr as typeof process.stderr.write;
      cap.restore();
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("renders the emoji summary line via --emoji", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      const cap = capture();
      try {
        await lock(["--emoji"], cfg(root));
        expect(cap.out()).toContain("🔒 finalize free, queue 0");
      } finally {
        cap.restore();
      }
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("reports a dead holder with the stale-remedy line", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    try {
      writeFileSync(join(root, LOCK_FILENAME), "2147483000\n");
      const cap = capture();
      try {
        await lock([], cfg(root));
        const out = cap.out();
        expect(out).toContain("(dead)");
        expect(out).toContain("stale: holder is dead");
        expect(out).toContain(join(root, LOCK_FILENAME));
        expect(out).not.toContain("recovery: rm -rf");
      } finally {
        cap.restore();
      }
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("suggests slot recovery when check slots are in use", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    mkdirSync(join(slotDir, "0"), { recursive: true });
    try {
      const cap = capture();
      try {
        await lock([], cfg(root));
        const out = cap.out();
        expect(out).toContain("check-slots: 1/");
        expect(out).toContain(`recovery: rm -rf ${slotDir}`);
      } finally {
        cap.restore();
      }
    } finally {
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("treats an unreadable lockfile as held-but-holderless", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    const lockPath = join(root, LOCK_FILENAME);
    writeFileSync(lockPath, "definitely not a pid\n");
    try {
      const cap = capture();
      try {
        await lock([], cfg(root));
        const out = cap.out();
        expect(out).toContain("finalize: held");
        expect(out).not.toContain("holder: PID");
        expect(out).toContain("queue: 0 waiting");
      } finally {
        cap.restore();
      }
      // A permission-locked lockfile fails the read, not the parse: the
      // holder is still reported as unknown (held, holderless).
      chmodSync(lockPath, 0o000);
      const report = collectLockReport(cfg(root), Date.now());
      expect(report.finalize).toBe("held");
      expect(report.holderPid).toBeUndefined();
      expect(report.holderAlive).toBeUndefined();
    } finally {
      chmodSync(lockPath, 0o644);
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
  });

  it("reports queue depth and unreadable-slot fallbacks from the human output", async () => {
    const { root, slotDir } = fixture();
    process.env.GIWT_CHECK_SLOT_DIR = slotDir;
    const lockPath = join(root, LOCK_FILENAME);
    writeFileSync(lockPath, `${process.pid}\n`);
    const queueDir = `${lockPath}.queue`;
    mkdirSync(join(queueDir, "000001-999"), { recursive: true });
    // In-use slot dir, then drop read permission to exercise the readdir guard.
    mkdirSync(join(slotDir, "0"), { recursive: true });
    chmodSync(slotDir, 0o000);
    let report: Awaited<ReturnType<typeof collectLockReport>>;
    const cap = capture();
    try {
      await lock([], cfg(root));
      expect(cap.out()).toContain("queue: 1 waiting");
      report = collectLockReport(cfg(root));
    } finally {
      chmodSync(slotDir, 0o755);
      cap.restore();
      delete process.env.GIWT_CHECK_SLOT_DIR;
    }
    expect(report.checkSlotsUsed).toBe(0);
    expect(existsSync(queueDir)).toBe(true);
  });
});
