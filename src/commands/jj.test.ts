// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** jj trailer filtering and the `giwt jj` passthrough gate. */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { beginRun, finishActiveRun } from "../utils/runlog";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { jjMessageArgs, jjPassthrough } from "./jj";

interface SpawnStub {
  calls: string[][];
  exitCode: number;
  out: string;
  err: string;
}

interface Restorable {
  mockRestore: () => void;
}

/** Replace Bun.spawnSync with a recorder — no real jj binary is ever spawned. */
function stubSpawn(stub: SpawnStub): void {
  Bun.spawnSync = ((cmd: string[]) => {
    stub.calls.push(cmd);
    const { exitCode, out, err } = stub;
    return {
      exitCode,
      stdout: Buffer.from(out),
      stderr: Buffer.from(err),
      success: exitCode === 0,
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

function configFor(repoRoot: string): WorktreeConfig {
  return {
    repoRoot,
    worktreeRoot: repoRoot,
    treeDir: join(repoRoot, "tree"),
    settings: DEFAULT_SETTINGS,
  };
}

/** Temp repo + stubbed spawn + captured console for one passthrough test. */
function setup(prefix: string): {
  root: string;
  config: WorktreeConfig;
  stub: SpawnStub;
} {
  const root = mkdtempSync(join(scratchRoot(), prefix));
  // Pin ALLOWED_TRAILERS empty so the walk-up cannot inherit host config.
  writeFileSync(join(root, ".credentials.env"), "ALLOWED_TRAILERS=\n");
  const stub: SpawnStub = { calls: [], exitCode: 0, out: "", err: "" };
  stubSpawn(stub);
  captureConsole();
  return { root, config: configFor(root), stub };
}

describe("jjMessageArgs", () => {
  test("strips LLM Co-Authored-By trailers from every -m/--message form", async () => {
    const repoRoot = mkdtempSync(join(scratchRoot(), "giwt-jj-msg-"));
    try {
      // Pin ALLOWED_TRAILERS empty so the walk-up cannot inherit host config.
      writeFileSync(join(repoRoot, ".credentials.env"), "ALLOWED_TRAILERS=\n");
      const config = configFor(repoRoot);
      const llm = "Co-Authored-By: Claude <claude@anthropic.com>";
      const human = "Co-Authored-By: Ada Lovelace <ada@example.com>";

      const split = await jjMessageArgs(
        ["commit", "-m", `feat: one\n\n${llm}\n${human}`, "--message", `fix: two\n\n${llm}`],
        config,
      );
      expect(split.args[2]).not.toContain(llm);
      expect(split.args[2]).toContain(human);
      expect(split.args[4]).not.toContain("Co-Authored-By");
      expect(split.tempFiles).toEqual([]);

      const inline = await jjMessageArgs(
        ["commit", `-m${llm}`, `--message=docs: three\n\n${llm}`],
        config,
      );
      expect(inline.args[1]).toBe("-m");
      expect(inline.args[2]).not.toContain(llm);
      expect(inline.args[2]).toContain("docs: three");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("jjPassthrough", () => {
  test("an empty invocation is refused before any spawn", async () => {
    const { root, config, stub } = setup("giwt-jj-empty-");
    try {
      await jjPassthrough([], config);
      expect(process.exitCode).toBe(1);
      expect(stub.calls).toEqual([]);
      expect(outChunks.join("")).toContain("Usage: giwt jj");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a leading -- is stripped and the argv reaches jj verbatim", async () => {
    const { root, config, stub } = setup("giwt-jj-dashdash-");
    try {
      await jjPassthrough(["--", "status"], config);
      expect(stub.calls).toEqual([["jj", "status"]]);
      expect(process.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a bypass env var is refused before jj runs", async () => {
    const { root, config, stub } = setup("giwt-jj-env-");
    const prev = process.env.JJ_CONFIG;
    process.env.JJ_CONFIG = "/tmp/jj-config.toml";
    try {
      await jjPassthrough(["status"], config);
      expect(process.exitCode).toBe(1);
      expect(stub.calls).toEqual([]);
      expect(errChunks.join("")).toContain("JJ_CONFIG");
    } finally {
      // Restore the host value: a global env delete would leak into other files.
      if (prev === undefined) delete process.env.JJ_CONFIG;
      else process.env.JJ_CONFIG = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a blocked subcommand never spawns jj", async () => {
    const { root, config, stub } = setup("giwt-jj-block-");
    try {
      await jjPassthrough(["bisect"], config);
      expect(process.exitCode).toBe(1);
      expect(stub.calls).toEqual([]);
      expect(errChunks.join("")).toContain("jj blocked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the LLM trailer is stripped before jj sees the message", async () => {
    const { root, config, stub } = setup("giwt-jj-trailer-");
    try {
      await jjPassthrough(
        ["commit", "-m", "feat: one\n\nCo-Authored-By: Claude <claude@anthropic.com>"],
        config,
      );
      expect(stub.calls).toHaveLength(1);
      const argv = stub.calls[0]!;
      expect(argv[0]).toBe("jj");
      expect(argv.join(" ")).not.toContain("Claude");
      expect(argv.join(" ")).toContain("feat: one");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("jj's exit code and stderr are propagated", async () => {
    const { root, config, stub } = setup("giwt-jj-exit-");
    stub.exitCode = 3;
    stub.out = "partial\n";
    stub.err = "boom\n";
    try {
      await jjPassthrough(["status"], config);
      expect(process.exitCode).toBe(3);
      expect(outChunks.join("")).toContain("partial");
      expect(errChunks.join("")).toContain("boom");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a failed capture is best-effort and never throws", async () => {
    const { root, config } = setup("giwt-jj-capture-fail-");
    const rec = beginRun(config, "jj", ["status"], null, "main");
    try {
      // Remove the run dir so the capture write fails (ENOENT).
      rmSync(rec!.dir, { recursive: true, force: true });
      await jjPassthrough(["status"], config);
      expect(process.exitCode).toBe(0);
    } finally {
      finishActiveRun(0);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the run record captures jj output and the jj:<sub> event", async () => {
    const { root, config, stub } = setup("giwt-jj-run-");
    stub.out = "the working copy is clean\n";
    const rec = beginRun(config, "jj", ["status"], null, "main");
    try {
      await jjPassthrough(["status"], config);
      expect(rec).not.toBeNull();
      const capture = join(rec!.dir, "jj-output.txt");
      expect(existsSync(capture)).toBe(true);
      const text = readFileSync(capture, "utf-8");
      expect(text).toContain("# exit=0");
      expect(text).toContain("the working copy is clean");
      const events = readFileSync(join(rec!.dir, "events.jsonl"), "utf-8");
      expect(events).toContain("\"step\":\"jj:status\"");
    } finally {
      // finish AND clear ACTIVE_RUN — a cached run leaks into later tests.
      finishActiveRun(0);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
