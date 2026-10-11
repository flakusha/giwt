// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { setLogLevel, setOutputFormat } from "../../utils/output";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { mapSourcesFor, runCodeMap } from "./code-map";

let root: string;
let config: WorktreeConfig;

function captureOutput(): { lines: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    lines: () => chunks.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

/** Mock process.exit to record the code and abort via a thrown marker. */
function mockExit(): { calls: number[]; restore: () => void; } {
  const original = process.exit;
  const calls: number[] = [];
  process.exit = ((code: number) => {
    calls.push(code);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    calls,
    restore: () => {
      process.exit = original;
    },
  };
}

/** Run runCodeMap with output captured; returns the joined output. */
async function run(args: string[]): Promise<string> {
  const cap = captureOutput();
  try {
    await runCodeMap(args, config);
  } finally {
    cap.restore();
  }
  return cap.lines();
}

/** Exit-path run: captures output and the mocked exit code. */
async function runExit(args: string[]): Promise<{ out: string; code: number; }> {
  const cap = captureOutput();
  const ex = mockExit();
  try {
    await runCodeMap(args, config);
  } catch (error) {
    expect(String(error).startsWith("Error: __exit:")).toBe(true);
  } finally {
    cap.restore();
    ex.restore();
  }
  return { out: cap.lines(), code: ex.calls.at(-1) ?? -1 };
}

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  root = mkdtempSync(join(scratchRoot(), "giwt-codemap-cmd-"));
  mkdirSync(join(root, ".plan/tickets"), { recursive: true });
  mkdirSync(join(root, "docs/spec"), { recursive: true });
  mkdirSync(join(root, "src/utils"), { recursive: true });
  writeFileSync(join(root, "src/utils/foo.ts"), "export {};\n");
  writeFileSync(
    join(root, ".plan/tickets/task.md"),
    "# TASK-1: widget\n\nOwns `src/utils/foo.ts` and the `src/utils` module root.\n",
  );
  writeFileSync(join(root, "docs/spec/api.md"), "# API\n\nDocuments `src/utils/foo.ts`.\n");
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runCodeMap", () => {
  test("default run writes code-map.json from the 4 map sources", async () => {
    const out = await run([]);
    const mapPath = join(root, ".plan", "code-map.json");
    expect(existsSync(mapPath)).toBe(true);
    const map = JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(map)).toContain("src/utils/foo.ts");
    expect(Object.keys(map)).toContain("src/utils");
    expect(out).toContain(`wrote ${mapPath} (2 src paths)`);
  });

  test("--find reports exact, prefix, and unreferenced queries", async () => {
    await run([]);
    const exact = await run(["--find", "src/utils/foo.ts"]);
    expect(exact).toContain("src/utils/foo.ts");
    expect(exact).toContain("[ticket] .plan/tickets/task.md");
    expect(exact).toContain("[spec] docs/spec/api.md");

    const prefix = await run(["--find", "src"]);
    expect(prefix).toContain("src (directory - 2 nested path(s) referenced)");

    const none = await run(["--find", "src/utils/absent.ts"]);
    expect(none).toContain("src/utils/absent.ts - not referenced by any plan/spec");
  });

  test("--find without a path argument exits 1", async () => {
    const { code, out } = await runExit(["--find"]);
    expect(code).toBe(1);
    expect(out).toContain("--find requires a path argument");
  });

  test("--check passes when fresh and fails after the map goes stale", async () => {
    await run([]);
    const ok = await run(["--check"]);
    expect(ok).toContain("OK - code map is up to date");

    writeFileSync(join(root, ".plan/tickets/extra.md"), "Later: `src/utils/other.ts`.\n");
    const { code, out } = await runExit(["--check"]);
    expect(code).toBe(1);
    expect(out).toContain("code-map.json is stale");
  });

  test("--stale is advisory for dangling refs and silent when clean", async () => {
    writeFileSync(join(root, ".plan/tickets/gone.md"), "Ghost: `src/utils/gone.ts`.\n");
    const out = await run(["--stale"]);
    expect(out).toContain("stale src ref: src/utils/gone.ts");
    expect(out).toContain("1 stale src reference(s) - advisory (future/renamed files)");

    rmSync(join(root, ".plan/tickets/gone.md"));
    const clean = await run(["--stale"]);
    expect(clean).toContain("OK - all src references resolve");
  });

  test("unknown args and --help hit the usage gate with the right exit code", async () => {
    const bad = await runExit(["--bogus"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("Usage: giwt plan code-map [--check] [--find <path>] [--stale]");

    const help = await runExit(["--help"]);
    expect(help.code).toBe(0);
  });

  test("mapSourcesFor fans out to tickets, epics, specs, and frontend docs", () => {
    expect(mapSourcesFor(".plan")).toEqual([
      { dir: ".plan/tickets", kind: "ticket" },
      { dir: ".plan/epics", kind: "epic" },
      { dir: "docs/spec", kind: "spec" },
      { dir: "docs/frontend", kind: "frontend" },
    ]);
  });
});
