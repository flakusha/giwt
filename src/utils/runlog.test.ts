// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/utils/runlog.ts — run-record lifecycle.
 *
 * Resource contract (parallel-safe): each test gets its own mkdtemp
 * "repo root"; run dirs are timestamp+pid unique, so parallel begins
 * never collide. No global state is asserted across tests.
 */

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginRun, listRuns } from "./runlog";
import { DEFAULT_SETTINGS } from "./settings";

function makeConfig(maxRuns = 200): { config: Parameters<typeof beginRun>[0]; root: string; } {
  const root = mkdtempSync(join(tmpdir(), "giwt-runlog-"));
  return {
    root,
    config: {
      repoRoot: root,
      treeDir: join(root, "tree"),
      settings: {
        ...DEFAULT_SETTINGS,
        paths: { ...DEFAULT_SETTINGS.paths, runlog: ".tmp/giwt" },
        runlog: { maxRuns },
      },
    },
  };
}

describe("beginRun", () => {
  test("creates announced dir with meta.json and finishes with exit code", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "test-cmd", ["arg1"], "ctx");
      expect(run).not.toBeNull();
      expect(existsSync(run!.dir)).toBe(true);
      expect(run!.dir.startsWith(join(root, ".tmp/giwt/runs"))).toBe(true);
      // meta.json exists BEFORE finish (partial record = in-flight/abnormal).
      const early = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(early.cmd).toBe("test-cmd");
      expect(early.exitCode).toBeUndefined();

      run!.finish(3);
      const done = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(done.exitCode).toBe(3);
      expect(done.end).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("events append to events.jsonl", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "ev-cmd", [], null);
      run!.event("step1", "ok");
      run!.event("step2", "fail", "because");
      const lines = readFileSync(join(run!.dir, "events.jsonl"), "utf8").trim().split("\n");
      expect(lines.length).toBe(2);
      const second = JSON.parse(lines[1]!);
      expect(second.step).toBe("step2");
      expect(second.status).toBe("fail");
      expect(second.detail).toBe("because");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capturePath resolves inside the run dir", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "cap-cmd", [], null);
      const p = run!.capturePath("check.log");
      expect(p.startsWith(run!.dir)).toBe(true);
      writeFileSync(p, "out");
      expect(existsSync(p)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listRuns", () => {
  test("lists runs newest-first with dir attached", () => {
    const { config, root } = makeConfig();
    try {
      const a = beginRun(config, "first", [], null);
      a!.finish(0);
      const b = beginRun(config, "second", [], null);
      b!.finish(1);
      const rows = listRuns(config, 20);
      expect(rows.length).toBe(2);
      expect(rows[0]!.cmd).toBe("second");
      expect(rows[0]!.exitCode).toBe(1);
      expect(rows[1]!.cmd).toBe("first");
      expect(existsSync(rows[0]!.dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns empty on missing scratchpad", () => {
    const { config, root } = makeConfig();
    try {
      expect(listRuns(config, 20)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skips corrupt meta.json rows", () => {
    const { config, root } = makeConfig();
    try {
      beginRun(config, "good", [], null);
      const runsRoot = join(root, ".tmp/giwt/runs");
      const badDir = join(runsRoot, "00000000T000000-0-bad");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, "meta.json"), "not json");
      const rows = listRuns(config, 20);
      expect(rows.length).toBe(1);
      expect(rows[0]!.cmd).toBe("good");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("pruning", () => {
  test("prunes oldest runs beyond maxRuns", () => {
    const { config, root } = makeConfig(3);
    try {
      for (const cmd of ["r1", "r2", "r3", "r4", "r5"]) {
        beginRun(config, cmd, [], null);
      }
      const runsRoot = join(root, ".tmp/giwt/runs");
      const remaining = readdirSync(runsRoot);
      expect(remaining.length).toBe(3);
      // The OLDEST entries were pruned, the newest kept.
      expect(remaining.some((n) => n.endsWith("r1"))).toBe(false);
      expect(remaining.some((n) => n.endsWith("r5"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
