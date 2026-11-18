// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
/**
 * Resource contract: pure input strings only — no filesystem, env, ports,
 * process state or module globals.
 */
import { describe, expect, test } from "bun:test";
import { hasUnresolvedConflicts, parsePullConflicts } from "./conflicts";

describe("parsePullConflicts", () => {
  test("reads the pull --json shape and ignores unknown keys", () => {
    const stdout = JSON.stringify({
      upstream: "origin",
      conflicts: [
        { kind: "add/add", path: "src/a.ts", line: 12, extra: "ignored" },
        { kind: "edit/edit", path: "src/b.ts" },
      ],
      ignored: { deep: true },
    });
    expect(parsePullConflicts(stdout)).toEqual([
      { kind: "add/add", path: "src/a.ts", line: 12 },
      { kind: "edit/edit", path: "src/b.ts" },
    ]);
  });

  test("accepts a top-level array and an object map of conflicts", () => {
    expect(parsePullConflicts(JSON.stringify([{ kind: "k", path: "p" }]))).toEqual([
      { kind: "k", path: "p" },
    ]);
    expect(
      parsePullConflicts(
        JSON.stringify({ conflicts: { first: { kind: "k", path: "p", line: 3 } } }),
      ),
    ).toEqual([{ kind: "k", path: "p", line: 3 }]);
  });

  test("skips malformed entries and coerces a numeric line string", () => {
    const stdout = JSON.stringify({
      conflicts: [
        null,
        "text",
        42,
        { kind: "k" },
        { path: "p" },
        { kind: "k", path: "p", line: "x" },
      ],
    });
    expect(parsePullConflicts(stdout)).toEqual([{ kind: "k", path: "p" }]);
    expect(
      parsePullConflicts(JSON.stringify({ conflicts: [{ kind: "k", path: "p", line: "7" }] })),
    ).toEqual([{ kind: "k", path: "p", line: 7 }]);
  });

  test("never throws on malformed text, returning []", () => {
    for (const stdout of ["", "   ", "not json", "{", "[] trailing", "null", "42"]) {
      expect(parsePullConflicts(stdout), stdout).toEqual([]);
    }
  });
});

describe("hasUnresolvedConflicts", () => {
  test("true for structured conflicts and for raw conflict markers", () => {
    expect(hasUnresolvedConflicts(JSON.stringify({ conflicts: [{ kind: "k", path: "p" }] }))).toBe(
      true,
    );
    expect(
      hasUnresolvedConflicts("pulling...\n<<<<<<< theirs\nours\n=======\ntheirs\n>>>>>>> theirs\n"),
    ).toBe(true);
  });

  test("false for clean output, unknown keys and malformed text", () => {
    for (
      const stdout of [
        JSON.stringify({ conflicts: [] }),
        JSON.stringify({ remote: "origin" }),
        "pijul pull ok",
        "{broken",
      ]
    ) {
      expect(hasUnresolvedConflicts(stdout), stdout).toBe(false);
    }
  });
});
