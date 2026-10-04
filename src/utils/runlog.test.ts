// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/utils/runlog.ts — run-record lifecycle.
 *
 * Coverage:
 *   - beginRun announces a run dir under the REPO root (not the worktree),
 *     records the resolved branch, and finishes with end + exitCode.
 *   - Records survive worktree removal (they must not die with the tree).
 *   - recorder.outcome merges partial summaries onto meta.json before
 *     finish; listRuns exposes them (the `giwt runs --json` payload).
 *   - finishActiveRun — the process exit hook body — backfills
 *     end/exitCode for runs the handler never finished (process.exit
 *     paths); finish is idempotent, so the hook never overwrites one.
 *   - events append to events.jsonl with `durationMs` measured from the
 *     previous event (the first event omits the key); capturePath stays
 *     inside the run dir; pruning keeps the newest maxRuns dirs.
 *
 * Resource contract (parallel-safe): each test gets its own mkdtemp
 * "repo root"; run dirs are timestamp+pid unique, so parallel begins
 * never collide. No global state is asserted across tests.
 */

import { describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beginRun, finishActiveRun, formatOutcome, listRuns, readRunEvents } from "./runlog";
import { scratchRoot } from "./scratch-tmp";
import { DEFAULT_SETTINGS } from "./settings";

function makeConfig(maxRuns = 200): {
  config: Parameters<typeof beginRun>[0];
  root: string;
  wt: string;
} {
  const root = mkdtempSync(join(scratchRoot(), "giwt-runlog-"));
  // A worktree that is NOT the repo root — finalize removes it, run
  // records must live on under `root`.
  const wt = join(root, "tree", "feat-x");
  mkdirSync(wt, { recursive: true });
  return {
    root,
    wt,
    config: {
      repoRoot: root,
      worktreeRoot: wt,
      treeDir: join(root, "tree"),
      settings: {
        ...DEFAULT_SETTINGS,
        paths: { ...DEFAULT_SETTINGS.paths, runlog: ".tmp/giwt" },
        runlog: { maxRuns },
      },
    },
  };
}

/**
 * Drive the process' registered `exit` listeners in-process, the way node/bun
 * do at real process exit. A test file never exits, so the hook beginRun()
 * installs would otherwise never run. Returns how many listeners were called.
 *
 * Bun's process.exitCode is non-configurable and ignores `= undefined`, so the
 * value is always reset to 0 — a stale 1 here would fail an otherwise green run.
 */
function fireExitListeners(exitCode: number): number {
  process.exitCode = exitCode;
  let called = 0;
  for (const listener of process.listeners("exit")) {
    if (typeof listener === "function") {
      listener(exitCode);
      called++;
    }
  }
  process.exitCode = 0;
  return called;
}

describe("beginRun", () => {
  test("creates announced dir under repoRoot with resolved branch, finishes with exit code", () => {
    const { config, root, wt } = makeConfig();
    try {
      const run = beginRun(config, "test-cmd", ["arg1"], "ctx", "feat-x");
      expect(run).not.toBeNull();
      expect(existsSync(run!.dir)).toBe(true);
      // Under the REPO root — and the worktree stayed untouched.
      expect(run!.dir.startsWith(join(root, ".tmp/giwt/runs"))).toBe(true);
      expect(run!.dir.startsWith(wt)).toBe(false);
      // meta.json exists BEFORE finish (partial record = in-flight/abnormal).
      const early = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(early.cmd).toBe("test-cmd");
      expect(early.branch).toBe("feat-x");
      expect(early.exitCode).toBeUndefined();

      run!.finish(3);
      const done = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(done.exitCode).toBe(3);
      expect(done.end).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("run records survive worktree removal", () => {
    const { config, root, wt } = makeConfig();
    try {
      const run = beginRun(config, "finalize", ["feat-x"], null, "feat-x");
      run!.outcome({ mergeCommit: "abc1234567890" });
      run!.finish(0);
      // What finalize's Step 6 does: the worktree (and any evidence in it)
      // disappears.
      rmSync(wt, { recursive: true, force: true });
      const rows = listRuns(config, 20);
      expect(rows.length).toBe(1);
      expect(rows[0]!.cmd).toBe("finalize");
      expect(rows[0]!.exitCode).toBe(0);
      expect(rows[0]!.outcome?.mergeCommit).toBe("abc1234567890");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("outcome merges partial summaries and stays visible before finish", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "check", [], null, "dev");
      run!.outcome({ failedGates: ["lint"] });
      const mid = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(mid.outcome.failedGates).toEqual(["lint"]);
      run!.outcome({ failedGates: ["lint", "tests"], doctor: "2/6 ok, 2 failed" });
      const done = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(done.outcome.failedGates).toEqual(["lint", "tests"]);
      expect(done.outcome.doctor).toBe("2/6 ok, 2 failed");
      // And the `giwt runs --json` payload (listRuns) exposes it.
      const rows = listRuns(config, 20);
      expect(rows[0]!.outcome?.failedGates).toEqual(["lint", "tests"]);
      expect(rows[0]!.outcome?.doctor).toBe("2/6 ok, 2 failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finishActiveRun backfills end/exitCode when the handler never finished", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "doctor", ["check"], null, "master");
      // What the exit hook runs for a `process.exit(1)` deep inside a
      // handler: the process exits with code 1 and no finish() happened.
      finishActiveRun(1);
      const done = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(done.exitCode).toBe(1);
      expect(done.end).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finish is idempotent — finishActiveRun never overwrites a finished run", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "ok-cmd", [], null, "dev");
      run!.finish(0);
      // The exit hook fires after the dispatch already finished the run.
      finishActiveRun(1);
      const done = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(done.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("events append to events.jsonl, timing each step from the previous one", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "ev-cmd", [], null, "dev");
      run!.event("step1", "ok");
      Bun.sleepSync(10);
      run!.event("step2", "fail", "because");
      const lines = readFileSync(join(run!.dir, "events.jsonl"), "utf8").trim().split("\n");
      expect(lines.length).toBe(2);
      const first = JSON.parse(lines[0]!);
      expect(first.step).toBe("step1");
      // First event of a run: no predecessor, so the key is ABSENT, never 0.
      expect(Object.hasOwn(first, "durationMs")).toBe(false);
      const second = JSON.parse(lines[1]!);
      expect(second.step).toBe("step2");
      expect(second.status).toBe("fail");
      expect(second.detail).toBe("because");
      // Measured at write time, not derived by the reader: the persisted
      // delta covers the sleep above.
      expect(Number.isInteger(second.durationMs)).toBe(true);
      expect(second.durationMs).toBeGreaterThanOrEqual(10);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capturePath resolves inside the run dir", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "cap-cmd", [], null, "dev");
      const p = run!.capturePath("check.log");
      expect(p.startsWith(run!.dir)).toBe(true);
      writeFileSync(p, "out");
      expect(existsSync(p)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns null and keeps the existing record when the run dir already exists", () => {
    const { config, root } = makeConfig();
    try {
      // runId() is `<second-precision timestamp>-<pid>-<cmd>`, so a second
      // beginRun in the same second for the same command targets the same dir.
      // mkdirSync (non-recursive) must refuse it rather than reuse the dir and
      // clobber the in-flight record's meta.json.
      const first = beginRun(config, "dup-cmd", [], null, "dev");
      expect(first).not.toBeNull();
      first!.outcome({ mergeCommit: "firstrun" });
      const second = beginRun(config, "dup-cmd", [], null, "dev");
      expect(second).toBeNull();
      // The first record is intact: the refused begin did not overwrite it.
      const rows = listRuns(config, 20);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.cmd).toBe("dup-cmd");
      expect(rows[0]!.outcome?.mergeCommit).toBe("firstrun");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the installed exit hook backfills the run it finds active", () => {
    const { config, root } = makeConfig();
    try {
      // beginRun installs the hook once per process; nothing in this file ever
      // exits, so the installed listener is driven directly — exactly what
      // node/bun do at process exit. It must backfill the in-flight run.
      const run = beginRun(config, "hook-cmd", [], null, "dev");
      expect(run).not.toBeNull();
      const before = process.exitCode;
      // The hook reads process.exitCode, which the runner only sets on a real
      // failure, so seed it: that is the whole point of the backfill — a
      // handler that died via process.exit(1) never called finish().
      expect(before).not.toBe(1);
      const fired = fireExitListeners(1);
      expect(fired).toBeGreaterThan(0);
      const done = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(done.exitCode).toBe(1);
      expect(done.end).toBeDefined();
      // Firing again must not resurrect the finished run or overwrite its code.
      fireExitListeners(9);
      const again = JSON.parse(readFileSync(join(run!.dir, "meta.json"), "utf8"));
      expect(again.exitCode).toBe(1);
      // Left clean, so this test cannot fail the run it lives in.
      expect(process.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listRuns", () => {
  test("lists runs newest-first with dir attached", () => {
    const { config, root } = makeConfig();
    try {
      const a = beginRun(config, "first", [], null, "dev");
      a!.finish(0);
      const b = beginRun(config, "second", [], null, "dev");
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
      beginRun(config, "good", [], null, "dev");
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

  test("returns empty when the runs root is not a directory", () => {
    const { config, root } = makeConfig();
    try {
      // A stray file where the runs dir belongs: existsSync() passes, then the
      // readdirSync throws. `giwt runs` must report nothing rather than crash.
      mkdirSync(join(root, ".tmp/giwt"), { recursive: true });
      writeFileSync(join(root, ".tmp/giwt/runs"), "not a directory");
      expect(listRuns(config, 20)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readRunEvents", () => {
  test("reads events in write order and tolerates a torn tail line", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "ev-read", [], null, "dev");
      run!.event("step1", "ok");
      run!.event("step2", "fail");
      // A process killed mid-append leaves a half-written last line.
      appendFileSync(join(run!.dir, "events.jsonl"), "{\"v\":1,\"ts\":\"x\",\"ste");
      const events = readRunEvents(run!.dir);
      expect(events.length).toBe(2);
      expect(events.map((e) => e.step)).toEqual(["step1", "step2"]);
      expect(Object.hasOwn(events[0]!, "durationMs")).toBe(false);
      expect(events[1]!.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns empty when the run recorded no events", () => {
    const { config, root } = makeConfig();
    try {
      const run = beginRun(config, "ev-none", [], null, "dev");
      expect(readRunEvents(run!.dir)).toEqual([]);
      expect(readRunEvents(join(root, "does-not-exist"))).toEqual([]);
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
        beginRun(config, cmd, [], null, "dev");
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

describe("formatOutcome", () => {
  test("renders empty string without outcome data", () => {
    expect(formatOutcome(undefined)).toBe("");
    expect(formatOutcome({})).toBe("");
  });

  test("joins the present fields", () => {
    expect(
      formatOutcome({
        failedGates: ["lint", "tests"],
        mergeCommit: "abc1234567890",
        doctor: "4/6 ok",
      }),
    ).toBe("failed: lint,tests; merged: abc123456; doctor: 4/6 ok");
  });

  test("renders sync counts with advisory suffix only when present", () => {
    expect(formatOutcome({
      sync: {
        tickets: 30,
        fixesApplied: 2,
        issuesRemaining: 0,
        advisoryRemaining: 0,
      },
    })).toBe("sync: 2 fixed, 0 remaining");
    expect(formatOutcome({
      sync: {
        tickets: 30,
        fixesApplied: 0,
        issuesRemaining: 1,
        advisoryRemaining: 3,
      },
    })).toBe("sync: 0 fixed, 1 remaining (3 advisory)");
  });
});
