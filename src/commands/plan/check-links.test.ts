// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan check-links` command tests: the mutating --fix path ends with
 * the one-line outcome contract (ok when the re-scan is clean, fail naming
 * what still stays broken); a read-only run keeps its plain scan report.
 *
 * Convention: real tmp fixture, no mock.module; output captured via
 * process.stdout/stderr.write spies; process.exit mocked with the
 * __exit sentinel (same as code-map.test.ts).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { setLogLevel, setOutputFormat, setRunContext } from "../../utils/output";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { runCheckLinks } from "./check-links";

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
    await runCheckLinks(args, config);
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
  root = mkdtempSync(join(scratchRoot(), "giwt-checklinks-cmd-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, ".plan/tickets"), { recursive: true });
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

describe("runCheckLinks --fix (one-line outcome contract)", () => {
  test("fixable break: --fix repairs it and ends with exactly one ok outcome line", async () => {
    mkdirSync(join(root, "docs/deep"), { recursive: true });
    writeFileSync(join(root, "docs/deep/moved.md"), "# moved\n");
    writeFileSync(join(root, "docs/note.md"), "[x](./moved.md)\n");
    const { out, code } = await run(["--fix"]);
    expect(code).toBe(0);
    expect(outcomeLines(out)).toEqual(["ok ? 1 repair(s) applied; links resolve"]);
    // The repair actually landed in the file.
    expect(readFileSync(join(root, "docs/note.md"), "utf8")).toContain("./deep/moved.md");
  });

  test("unfixable break: exit 1 with a fail outcome naming the residue", async () => {
    writeFileSync(join(root, "docs/note.md"), "[x](./missing.md)\n");
    const { out, code } = await run(["--fix"]);
    expect(code).toBe(1);
    expect(outcomeLines(out)).toEqual(["fail ? 1 broken link(s)/ref(s) remain after fix"]);
  });

  test("read-only run (no --fix) keeps its plain scan report — no outcome line", async () => {
    writeFileSync(join(root, "docs/note.md"), "[x](./missing.md)\n");
    const { out, code } = await run([]);
    expect(code).toBe(1);
    expect(out).toContain("1 broken link(s)/ref(s) found");
    expect(outcomeLines(out)).toEqual([]);
  });

  test("unknown flags refuse with usage and exit 1", async () => {
    const { out, code } = await run(["--bogus"]);
    expect(code).toBe(1);
    expect(out).toContain("Usage: giwt plan check-links [--fix]");
  });

  test("--fix repairs a stale TASK ref to its unique candidate", async () => {
    // Renamed-ticket shape: the ticket file grew a suffix, the prose ref
    // kept the old prefix (scanner accepts the prefix; fixer canonicalizes).
    writeFileSync(join(root, ".plan/tickets/task-add-trace-fatal.md"), "# TASK: add trace\n");
    writeFileSync(join(root, ".plan/notes.md"), "Planned in TASK-add-trace.\n");
    const { out, code } = await run(["--fix"]);
    expect(code).toBe(0);
    expect(out).toContain("TASK ref TASK-add-trace -> TASK-add-trace-fatal");
    expect(outcomeLines(out)).toEqual(["ok ? 1 repair(s) applied; links resolve"]);
    expect(readFileSync(join(root, ".plan/notes.md"), "utf8")).toContain("TASK-add-trace-fatal");
  });

  test("orphan TASK refs and broken comment citations are reported", async () => {
    writeFileSync(join(root, ".plan/notes.md"), "Planned in TASK-gone.\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/see.ts"), "// See .plan/gone.md for details.\nexport {};\n");
    const { out, code } = await run([]);
    expect(code).toBe(1);
    expect(out).toContain("orphan TASK ref TASK-gone");
    expect(out).toContain("broken comment citation -> .plan/gone.md");
    expect(outcomeLines(out)).toEqual([]);
  });
});
