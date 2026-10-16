// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the `giwt ledger` command: --state/--cmd/--branch post-filters
 * (FEAT-ledger-lifecycle-truthfulness) and the JSON dump shape.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { LEDGER_FILENAME } from "../utils/ledger";
import { ledger } from "./ledger";

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeTreeDir(): string {
  const dir = join("/tmp", `giwt-ledger-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempRoots.push(dir);
  return dir;
}

function cfg(treeDir: string): WorktreeConfig {
  return {
    treeDir,
    repoRoot: treeDir,
    worktreeRoot: treeDir,
    settings: {} as WorktreeConfig["settings"],
  } as unknown as WorktreeConfig;
}

function rec(pid: number, cmd: string, branch: string, msg: string, state: string): string {
  return JSON.stringify({
    v: 2,
    ts: "2026-10-16T07:00:00Z",
    pid,
    agent: `host:${pid}`,
    cmd,
    branch,
    msg,
    state,
    seq: pid,
  });
}

/** Two finished syncs on different branches + one postponed commit. */
function seedLedger(dir: string): void {
  writeFileSync(
    join(dir, LEDGER_FILENAME),
    [
      rec(1, "sync", "dev", "sync", "finished"),
      rec(2, "sync", "feat", "sync", "finished"),
      rec(3, "commit", "feat", "commit x :: exit 1", "postponed"),
    ].join("\n") + "\n",
  );
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

describe("giwt ledger filters", () => {
  it("--state filters records", async () => {
    const dir = makeTreeDir();
    seedLedger(dir);
    const cap = capture();
    try {
      await ledger(["--state", "postponed"], cfg(dir));
      const out = cap.out();
      expect(out).toContain("commit");
      expect(out).not.toContain("] sync:");
    } finally {
      cap.restore();
    }
  });

  it("--cmd filters records", async () => {
    const dir = makeTreeDir();
    seedLedger(dir);
    const cap = capture();
    try {
      await ledger(["--cmd", "sync"], cfg(dir));
      const out = cap.out();
      expect(out).toContain("[#1]");
      expect(out).toContain("[#2]");
      expect(out).not.toContain("commit");
    } finally {
      cap.restore();
    }
  });

  it("--branch filters records", async () => {
    const dir = makeTreeDir();
    seedLedger(dir);
    const cap = capture();
    try {
      await ledger(["--branch", "feat"], cfg(dir));
      const out = cap.out();
      expect(out).toContain("[#2]");
      expect(out).toContain("[#3]");
      expect(out).not.toContain("[#1]");
    } finally {
      cap.restore();
    }
  });

  it("--json dumps the filtered records", async () => {
    const dir = makeTreeDir();
    seedLedger(dir);
    const cap = capture();
    try {
      await ledger(["--json", "--cmd", "commit"], cfg(dir));
      const payload = JSON.parse(cap.out());
      expect(payload.length).toBe(1);
      expect(payload[0].state).toBe("postponed");
    } finally {
      cap.restore();
    }
  });
});
