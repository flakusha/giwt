// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** The `giwt pijul` passthrough gate: argv classification, spawn, exit code. */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { beginRun, finishActiveRun } from "../utils/runlog";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { pijulPassthrough } from "./pijul";

interface SpawnStub {
  calls: string[][];
  exitCode: number;
  out: string;
  err: string;
}

interface Restorable {
  mockRestore: () => void;
}

/** Replace Bun.spawnSync with a recorder — no real pijul binary is ever spawned. */
function stubSpawn(stub: SpawnStub): void {
  Bun.spawnSync = ((cmd: string[]) => {
    stub.calls.push(cmd);
    return {
      exitCode: stub.exitCode,
      stdout: Buffer.from(stub.out),
      stderr: Buffer.from(stub.err),
      success: stub.exitCode === 0,
      signal: null,
    };
  }) as unknown as typeof Bun.spawnSync;
}

const realSpawn = Bun.spawnSync;
let outChunks: string[] = [];
let errChunks: string[] = [];
let outSpy: Restorable | null = null;
let errSpy: Restorable | null = null;

afterEach(() => {
  Bun.spawnSync = realSpawn;
  outSpy?.mockRestore();
  errSpy?.mockRestore();
  outSpy = null;
  errSpy = null;
  outChunks = [];
  errChunks = [];
  // Bun ignores an `undefined` reset; 0 is the explicit "not a failure" value.
  process.exitCode = 0;
});

function captureConsole(): void {
  const push = (chunk: unknown): boolean => {
    outChunks.push(String(chunk));
    return true;
  };
  const pushErr = (chunk: unknown): boolean => {
    errChunks.push(String(chunk));
    return true;
  };
  outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  errSpy = spyOn(process.stderr, "write").mockImplementation(pushErr as never);
}

function makeRepo(prefix: string): { root: string; config: WorktreeConfig; } {
  const root = mkdtempSync(join(scratchRoot(), prefix));
  const config: WorktreeConfig = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
  return { root, config };
}

describe("pijulPassthrough", () => {
  test("an empty invocation is refused before any spawn", async () => {
    const { root, config } = makeRepo("giwt-pijul-empty-");
    const stub: SpawnStub = { calls: [], exitCode: 0, out: "", err: "" };
    stubSpawn(stub);
    captureConsole();
    try {
      await pijulPassthrough([], config);
      expect(process.exitCode).toBe(1);
      expect(stub.calls).toEqual([]);
      expect(outChunks.join("")).toContain("Usage: giwt pijul");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a leading -- is stripped and the argv reaches pijul verbatim", async () => {
    const { root, config } = makeRepo("giwt-pijul-dashdash-");
    const stub: SpawnStub = { calls: [], exitCode: 0, out: "", err: "" };
    stubSpawn(stub);
    captureConsole();
    try {
      await pijulPassthrough(["--", "status"], config);
      expect(stub.calls).toEqual([["pijul", "status"]]);
      expect(process.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a blocked subcommand never spawns pijul", async () => {
    const { root, config } = makeRepo("giwt-pijul-block-");
    const stub: SpawnStub = { calls: [], exitCode: 0, out: "", err: "" };
    stubSpawn(stub);
    captureConsole();
    try {
      await pijulPassthrough(["reset"], config);
      expect(process.exitCode).toBe(1);
      expect(stub.calls).toEqual([]);
      expect(errChunks.join("")).toContain("pijul blocked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("pijul's exit code and stderr are propagated", async () => {
    const { root, config } = makeRepo("giwt-pijul-exit-");
    const stub: SpawnStub = { calls: [], exitCode: 4, out: "partial\n", err: "boom\n" };
    stubSpawn(stub);
    captureConsole();
    try {
      await pijulPassthrough(["status"], config);
      expect(process.exitCode).toBe(4);
      expect(outChunks.join("")).toContain("partial");
      expect(errChunks.join("")).toContain("boom");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a failed capture is best-effort and never throws", async () => {
    const { root, config } = makeRepo("giwt-pijul-capture-fail-");
    const stub: SpawnStub = { calls: [], exitCode: 0, out: "ok\n", err: "" };
    stubSpawn(stub);
    captureConsole();
    const rec = beginRun(config, "pijul", ["status"], null, "main");
    try {
      // Remove the run dir so the capture write fails (ENOENT).
      rmSync(rec!.dir, { recursive: true, force: true });
      await pijulPassthrough(["status"], config);
      expect(process.exitCode).toBe(0);
    } finally {
      finishActiveRun(0);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the run record captures pijul output and the pijul:<sub> event", async () => {
    const { root, config } = makeRepo("giwt-pijul-run-");
    const stub: SpawnStub = { calls: [], exitCode: 0, out: "the channel is clean\n", err: "" };
    stubSpawn(stub);
    captureConsole();
    const rec = beginRun(config, "pijul", ["status"], null, "main");
    try {
      await pijulPassthrough(["status"], config);
      expect(rec).not.toBeNull();
      const capture = join(rec!.dir, "pijul-output.txt");
      expect(existsSync(capture)).toBe(true);
      const text = readFileSync(capture, "utf-8");
      expect(text).toContain("# exit=0");
      expect(text).toContain("the channel is clean");
      const events = readFileSync(join(rec!.dir, "events.jsonl"), "utf-8");
      expect(events).toContain("\"step\":\"pijul:status\"");
    } finally {
      // finish AND clear ACTIVE_RUN — a cached run leaks into later tests.
      finishActiveRun(0);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("pull conflicts in pijul output are surfaced on the run record", async () => {
    const { root, config } = makeRepo("giwt-pijul-conflict-");
    const conflict = JSON.stringify({
      conflicts: [{ kind: "add/add", path: "src/a.ts", line: 3 }],
    });
    const stub: SpawnStub = { calls: [], exitCode: 1, out: conflict, err: "" };
    stubSpawn(stub);
    captureConsole();
    const rec = beginRun(config, "pijul", ["pull"], null, "main");
    try {
      await pijulPassthrough(["pull"], config);
      const events = readFileSync(join(rec!.dir, "events.jsonl"), "utf-8");
      expect(events).toContain("\"step\":\"pijul:conflicts\"");
      expect(existsSync(join(rec!.dir, "pijul-conflicts.json"))).toBe(true);
    } finally {
      finishActiveRun(0);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
