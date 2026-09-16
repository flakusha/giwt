// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/plan/src-refs.ts — pure helpers for plan↔code cross-reference
 * extraction.
 *
 * Pure functions — no fs/env, just string in → data out.
 */

import { describe, expect, test } from "bun:test";
import { extractComments, extractDocRefs, extractSrcRefs, stripMarkdownCode } from "./src-refs";

// ── stripMarkdownCode ───────────────────────────────────────────

describe("stripMarkdownCode", () => {
  test("strips fenced code blocks", () => {
    const md = "text\n```ts\nconst x = 1;\n```\nmore text";
    expect(stripMarkdownCode(md)).toBe("text\n\nmore text");
  });

  test("strips multiple fenced blocks", () => {
    const md = "a\n```\ncode1\n```\nb\n```\ncode2\n```\nc";
    expect(stripMarkdownCode(md)).toBe("a\n\nb\n\nc");
  });

  test("handles empty string", () => {
    expect(stripMarkdownCode("")).toBe("");
  });

  test("keeps inline code spans", () => {
    const md = "see `src/foo/bar.ts` for details";
    expect(stripMarkdownCode(md)).toBe("see `src/foo/bar.ts` for details");
  });

  test("handles unclosed fence (no match)", () => {
    const md = "text\n```\nunclosed";
    // Unclosed ``` — regex requires closing ``` so no match, text unchanged
    const result = stripMarkdownCode(md);
    expect(result).toBe(md);
  });
});

// ── extractSrcRefs ──────────────────────────────────────────────

describe("extractSrcRefs", () => {
  test("extracts src/ paths from prose", () => {
    const md = "This touches `src/utils/config.ts` and src/commands/plan.ts";
    const refs = extractSrcRefs(md);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.path).toBe("src/utils/config.ts");
    expect(refs[1]!.path).toBe("src/commands/plan.ts");
  });

  test("deduplicates refs", () => {
    const md = "See src/foo.ts and src/foo.ts again";
    const refs = extractSrcRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.path).toBe("src/foo.ts");
  });

  test("trims trailing punctuation", () => {
    const md = "Modified src/foo/bar.ts: and src/baz.ts. and src/qux.ts)";
    const refs = extractSrcRefs(md);
    expect(refs.map((r) => r.path)).toEqual([
      "src/foo/bar.ts",
      "src/baz.ts",
      "src/qux.ts",
    ]);
  });

  test("skips glob patterns", () => {
    const md = "See src/**/*.test.ts for tests";
    const refs = extractSrcRefs(md);
    expect(refs).toHaveLength(0);
  });

  test("skips bare src and src/", () => {
    const md = "The src/ directory and src are both valid";
    const refs = extractSrcRefs(md);
    expect(refs).toHaveLength(0);
  });

  test("skips paths ending with /", () => {
    const md = "See src/foo/ for files";
    const refs = extractSrcRefs(md);
    expect(refs).toHaveLength(0);
  });

  test("ignores refs inside fenced code blocks", () => {
    const md = "```\nsrc/inside/code.ts\n```\nbut src/outside.ts is found";
    const refs = extractSrcRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.path).toBe("src/outside.ts");
  });

  test("handles empty string", () => {
    expect(extractSrcRefs("")).toHaveLength(0);
  });

  test("handles no src refs", () => {
    expect(extractSrcRefs("just some text")).toHaveLength(0);
  });

  test("extracts paths with hyphens and underscores", () => {
    const md = "See src/plan/backlog-sync.ts and src/utils/my_thing.ts";
    const refs = extractSrcRefs(md);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.path).toBe("src/plan/backlog-sync.ts");
    expect(refs[1]!.path).toBe("src/utils/my_thing.ts");
  });
});

// ── extractComments ─────────────────────────────────────────────

describe("extractComments", () => {
  test("extracts block comments", () => {
    const src = "/* this is a comment */\nconst x = 1;";
    const comments = extractComments(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe("/* this is a comment */");
  });

  test("extracts line comments", () => {
    const src = "const x = 1; // see docs/spec/foo.md\nconst y = 2;";
    const comments = extractComments(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain("// see docs/spec/foo.md");
  });

  test("extracts multi-line block comments", () => {
    const src = "/*\n * line 1\n * see .plan/tickets/foo.md\n */\nconst x = 1;";
    const comments = extractComments(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain(".plan/tickets/foo.md");
  });

  test("does not match // inside strings", () => {
    const src = "const url = \"https://example.com\";\n// real comment";
    const comments = extractComments(src);
    // The string "https://..." should not be treated as a comment
    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe("// real comment");
  });

  test("does not match /* inside strings", () => {
    const src = "const x = \"/* not a comment */\";\n/* real comment */";
    const comments = extractComments(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe("/* real comment */");
  });

  test("handles empty source", () => {
    expect(extractComments("")).toHaveLength(0);
  });

  test("handles source with no comments", () => {
    expect(extractComments("const x = 1;\nconst y = 2;")).toHaveLength(0);
  });

  test("deduplicates comments at same position", () => {
    const src = "/* comment */ /* another */";
    const comments = extractComments(src);
    expect(comments).toHaveLength(2);
  });

  test("handles single-quoted strings with //", () => {
    const src = "const x = 'not // a comment';\n// real comment\n";
    const comments = extractComments(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe("// real comment");
  });

  test("handles template literals with //", () => {
    const src = "const x = `not // a comment`;\n// real comment\n";
    const comments = extractComments(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe("// real comment");
  });

  test("handles escaped quotes in strings", () => {
    const src = "const x = \"say \\\"hi\\\"\"; // real\n";
    const comments = extractComments(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toBe("// real");
  });
});

// ── extractDocRefs ──────────────────────────────────────────────

describe("extractDocRefs", () => {
  test("extracts docs/ paths", () => {
    const comment = "see docs/spec/architecture.md for details";
    const refs = extractDocRefs(comment);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.path).toBe("docs/spec/architecture.md");
  });

  test("extracts .plan/ paths", () => {
    const comment = "see .plan/tickets/BUG-foo.md";
    const refs = extractDocRefs(comment);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.path).toBe(".plan/tickets/BUG-foo.md");
  });

  test("deduplicates refs", () => {
    const comment = "see docs/spec/foo.md and docs/spec/foo.md again";
    const refs = extractDocRefs(comment);
    expect(refs).toHaveLength(1);
  });

  test("extracts multiple refs", () => {
    const comment = "see docs/a.md and .plan/b.md and docs/c.md";
    const refs = extractDocRefs(comment);
    expect(refs).toHaveLength(3);
  });

  test("handles empty string", () => {
    expect(extractDocRefs("")).toHaveLength(0);
  });

  test("handles no refs", () => {
    expect(extractDocRefs("just a comment with no paths")).toHaveLength(0);
  });

  test("does not match paths without .md", () => {
    expect(extractDocRefs("see docs/spec/architecture")).toHaveLength(0);
  });
});
