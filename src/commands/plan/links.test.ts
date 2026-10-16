// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan links` command tests: the mutating --write path ends with the
 * one-line outcome contract (ok on a clean write, fail naming lingering
 * error findings), while read-only runs keep their plain report.
 *
 * Convention: real tmp fixture, no mock.module; output captured via
 * process.stdout/stderr.write spies; process.exit mocked with the
 * __exit sentinel (same as code-map.test.ts).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { setLogLevel, setOutputFormat, setRunContext } from "../../utils/output";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { runLinks } from "./links";

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

/** Exit-path run: captures output and the mocked exit code. */
async function run(args: string[]): Promise<{ out: string; code: number; }> {
  const cap = captureOutput();
  const ex = mockExit();
  try {
    await runLinks(args, config);
  } catch (error) {
    if (!String(error).startsWith("Error: __exit:")) {
      cap.restore();
      ex.restore();
      throw error;
    }
  } finally {
    cap.restore();
    ex.restore();
  }
  return { out: cap.lines(), code: ex.calls.at(-1) ?? 0 };
}

/** Outcome lines under the one-line contract ("ok ? …" / "fail ? …" — the
 * plan command is ledger-silent, so runContext is null in tests). */
function outcomeLines(out: string): string[] {
  return out.split("\n").filter((l) => /^(ok|fail) /.test(l));
}

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  // plan is LEDGER_SILENT: no beginRun, so outcomeLine must resolve its
  // context to "?" — pin the global run context to make that explicit.
  setRunContext(null);
  root = mkdtempSync(join(scratchRoot(), "giwt-links-cmd-"));
  mkdirSync(join(root, ".plan/tickets"), { recursive: true });
  mkdirSync(join(root, ".plan/epics"), { recursive: true });
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

describe("runLinks --write (one-line outcome contract)", () => {
  test("clean write ends with exactly one ok outcome line", async () => {
    writeFileSync(
      join(root, ".plan/tickets/FEAT-a.md"),
      "# FEAT-a: a\n\n**Status:** Not Started\n\n**Summary:** owns `src/a.ts`.\n",
    );
    const { out, code } = await run(["--write"]);
    expect(code).toBe(0);
    expect(outcomeLines(out)).toEqual(["ok ? wrote interconnect pair (1 nodes, 1 edges)"]);
  });

  test("broken Related ref: write still lands, exit 1, fail outcome names the findings", async () => {
    writeFileSync(
      join(root, ".plan/tickets/FEAT-a.md"),
      "# FEAT-a: a\n\n**Status:** Not Started\n\n**Related:** FEAT-missing\n",
    );
    const { out, code } = await run(["--write"]);
    expect(code).toBe(1);
    expect(outcomeLines(out)).toEqual(["fail ? wrote pair; 1 error finding(s) remain"]);
  });
});

/** Two tickets sharing src/shared.ts via code-map, a **Related:** b. */
function seedSharedFixture(): void {
  writeFileSync(
    join(root, ".plan/tickets/FEAT-a.md"),
    "# FEAT-a: a\n\n**Status:** In Progress\n\n**Related:** FEAT-b\n\n**Summary:** owns `src/shared.ts`.\n",
  );
  writeFileSync(
    join(root, ".plan/tickets/FEAT-b.md"),
    "# FEAT-b: b\n\n**Status:** Not Started\n\n**Summary:** owns `src/shared.ts`.\n",
  );
  writeFileSync(
    join(root, ".plan/code-map.json"),
    JSON.stringify({
      "src/shared.ts": [
        { kind: "ticket", source: ".plan/tickets/FEAT-a.md" },
        { kind: "ticket", source: ".plan/tickets/FEAT-b.md" },
      ],
    }) + "\n",
  );
}

describe("runLinks read paths (usage, report, queries, check)", () => {
  test("--help and unknown flags print usage; exit 0 for help, 1 otherwise", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("Usage: giwt plan links");
    const bogus = await run(["--bogus"]);
    expect(bogus.code).toBe(1);
    expect(bogus.out).toContain("Usage: giwt plan links");
  });

  test("mode conflict and malformed query flags refuse with usage", async () => {
    const conflict = await run(["--write", "--check"]);
    expect(conflict.code).toBe(1);
    expect(conflict.out).toContain("Usage: giwt plan links");
    const missingValue = await run(["--for"]);
    expect(missingValue.code).toBe(1);
    const duplicate = await run(["--for", "a", "--for", "b"]);
    expect(duplicate.code).toBe(1);
  });

  test("default report summarizes nodes, hubs, and the generate hint", async () => {
    seedSharedFixture();
    const { out, code } = await run([]);
    expect(code).toBe(0);
    expect(out).toContain("interconnect: 2 nodes");
    expect(out).toContain("hub src/shared.ts: FEAT-a, FEAT-b");
    expect(out).toContain("generate: giwt plan links --write");
  });

  test("--json prints the raw graph payload", async () => {
    seedSharedFixture();
    const { out } = await run(["--json"]);
    const graph = JSON.parse(out) as { nodes: Array<{ id: string; }>; };
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["FEAT-a", "FEAT-b"]);
  });

  test("--for renders the node report with its edges", async () => {
    seedSharedFixture();
    const { out, code } = await run(["--for", "FEAT-a"]);
    expect(code).toBe(0);
    expect(out).toContain("FEAT-a (ticket");
    expect(out).toContain("--produces--> src/shared.ts");
  });

  test("--who-produces, --who-consumes, and --siblings answer from the graph", async () => {
    seedSharedFixture();
    const produces = await run(["--who-produces", "src/shared.ts"]);
    expect(produces.out.split("\n").filter((l) => l.startsWith("FEAT-"))).toEqual([
      "FEAT-a",
      "FEAT-b",
    ]);
    const consumes = await run(["--who-consumes", "src/shared.ts"]);
    expect(consumes.out).toContain("FEAT-");
    // A third co-owner with no **Related:** direction is a sibling of both
    // (a→b is directed, so they are not each other's siblings).
    writeFileSync(
      join(root, ".plan/tickets/FEAT-c.md"),
      "# FEAT-c: c\n\n**Status:** Done\n\n**Summary:** owns `src/shared.ts`.\n",
    );
    writeFileSync(
      join(root, ".plan/code-map.json"),
      JSON.stringify({
        "src/shared.ts": [
          { kind: "ticket", source: ".plan/tickets/FEAT-a.md" },
          { kind: "ticket", source: ".plan/tickets/FEAT-b.md" },
          { kind: "ticket", source: ".plan/tickets/FEAT-c.md" },
        ],
      }) + "\n",
    );
    const siblings = await run(["--siblings", "FEAT-c"]);
    expect(siblings.out).toContain("FEAT-a <-> FEAT-c via src/shared.ts");
    expect(siblings.out).toContain("FEAT-b <-> FEAT-c via src/shared.ts");
  });

  test("unknown query target errors and exits 1", async () => {
    seedSharedFixture();
    const { out, code } = await run(["--for", "FEAT-nope"]);
    expect(code).toBe(1);
    expect(out).toContain("no node or src path 'FEAT-nope'");
  });

  test("--check passes on a fresh pair and fails stale", async () => {
    seedSharedFixture();
    await run(["--write"]);
    const fresh = await run(["--check"]);
    expect(fresh.code).toBe(0);
    expect(fresh.out).toContain("OK - interconnect pair is up to date");
    writeFileSync(
      join(root, ".plan/tickets/FEAT-a.md"),
      "# FEAT-a: a\n\n**Status:** Blocked\n\n**Related:** FEAT-b\n\n**Summary:** owns `src/shared.ts`.\n",
    );
    const stale = await run(["--check"]);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain("stale (first difference at line");
  });
});
