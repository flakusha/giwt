// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/utils/failtriage.ts — pure parse/diff over crafted
 * captured bun-test logs. No fs, no spawn.
 *
 * Coverage:
 *   - parseFailBlocks: multi-fail logs across file sections, boundaries
 *     at blank line / next result marker / next file section, duration
 *     suffix stripping, multiline error context, the 15-line cap, and
 *     failure-free logs.
 *   - diffFailures: new/fixed by test-name identity, name+file identity
 *     when both sides carry files, name-only matching when file info is
 *     missing, and duplicate names within one run.
 */

import { describe, expect, test } from "bun:test";
import { diffFailures, type FailBlock, MAX_CONTEXT_LINES, parseFailBlocks } from "./failtriage";

const MULTI_FAIL = [
  "$ bun run test:unit",
  "src/a.test.ts:",
  "✓ adds fine [0.10ms]",
  "(fail) adds wrong [1.23ms]",
  "error: 1 !== 2",
  "",
  "      at /r/src/a.test.ts:4:10",
  "",
  "src/b.test.ts:",
  "(fail) breaks later [12.00ms]",
  "error: boom",
  "      at /r/src/b.test.ts:9:5",
  "(fail) second in b",
  "error: two",
  " 3 passes",
  " 2 fails",
  "Ran 5 tests across 2 files.",
  "",
].join("\n");

function block(name: string, file?: string): FailBlock {
  return { test: name, ...(file !== undefined ? { file } : {}), lines: [] };
}

describe("parseFailBlocks", () => {
  test("parses multi-fail logs grouped by file section", () => {
    const blocks = parseFailBlocks(MULTI_FAIL);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      test: "adds wrong",
      file: "src/a.test.ts",
      // Blank line right after the error line ends the context.
      lines: ["error: 1 !== 2"],
    });
    expect(blocks[1]).toEqual({
      test: "breaks later",
      file: "src/b.test.ts",
      // Next (fail) marker ends the context.
      lines: ["error: boom", "      at /r/src/b.test.ts:9:5"],
    });
    expect(blocks[2]!.test).toBe("second in b");
    expect(blocks[2]!.file).toBe("src/b.test.ts");
    expect(blocks[2]!.lines).toEqual([
      "error: two",
      " 3 passes",
      " 2 fails",
      "Ran 5 tests across 2 files.",
    ]);
  });

  test("caps multiline error context at MAX_CONTEXT_LINES", () => {
    const log = [
      "src/cap.test.ts:",
      "(fail) long failure",
      ...Array.from({ length: 20 }, (_, i) => `error line ${i + 1}`),
      "(fail) tail failure",
    ].join("\n");
    const blocks = parseFailBlocks(log);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lines).toHaveLength(MAX_CONTEXT_LINES);
    expect(blocks[0]!.lines[MAX_CONTEXT_LINES - 1]).toBe(`error line ${MAX_CONTEXT_LINES}`);
    // Cap must not swallow the following failure marker.
    expect(blocks[1]!.test).toBe("tail failure");
  });

  test("returns empty for a failure-free log", () => {
    const log = [
      "src/ok.test.ts:",
      "✓ passes [0.01ms]",
      "",
      " 1 passes",
      "Ran 1 test across 1 file.",
    ].join("\n");
    expect(parseFailBlocks(log)).toEqual([]);
    expect(parseFailBlocks("")).toEqual([]);
  });

  test("keeps failures file-less when the log carries no file sections", () => {
    const blocks = parseFailBlocks([
      "(fail) orphan failure",
      "error: no file header above",
    ].join("\n"));
    expect(blocks).toEqual([
      { test: "orphan failure", lines: ["error: no file header above"] },
    ]);
  });
});

describe("diffFailures", () => {
  test("classifies new and fixed by test name", () => {
    const diff = diffFailures([block("kept"), block("fixed-one")], [
      block("kept"),
      block("new-one"),
    ]);
    expect(diff.new).toEqual([block("new-one")]);
    expect(diff.fixed).toEqual([block("fixed-one")]);
  });

  test("returns empty diff for identical failure sets", () => {
    expect(diffFailures([block("x", "src/a.test.ts")], [block("x", "src/a.test.ts")])).toEqual({
      new: [],
      fixed: [],
    });
  });

  test("same name in different files counts as distinct when both sides carry files", () => {
    const diff = diffFailures([block("x", "src/old.test.ts")], [block("x", "src/new.test.ts")]);
    expect(diff.new).toEqual([block("x", "src/new.test.ts")]);
    expect(diff.fixed).toEqual([block("x", "src/old.test.ts")]);
  });

  test("missing file info on either side falls back to name-only identity", () => {
    const diff = diffFailures([block("x", "src/a.test.ts")], [block("x")]);
    expect(diff.new).toEqual([]);
    expect(diff.fixed).toEqual([]);
  });

  test("handles duplicate names within one run", () => {
    const a = [block("x", "src/f1.test.ts"), block("x", "src/f2.test.ts")];
    const b = [block("x", "src/f2.test.ts"), block("x", "src/f3.test.ts")];
    const diff = diffFailures(a, b);
    expect(diff.new).toEqual([block("x", "src/f3.test.ts")]);
    expect(diff.fixed).toEqual([block("x", "src/f1.test.ts")]);
  });
});
