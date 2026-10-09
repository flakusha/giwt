// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Unit coverage for the shared ticket-markdown emission helpers
 * (BUG-ticket-create-and-sync-fix-import-emit-lint-defective-duplic):
 * sanitizeTicketBody must turn the historical defect shapes (MD031/MD032/
 * MD033/MD040/MD012) into gate-clean markdown; detectNestedTicketDoc must
 * flag whole-ticket-document bodies while leaving fence content alone.
 */

import { describe, expect, test } from "bun:test";
import { detectNestedTicketDoc, sanitizeTicketBody } from "./ticket-md";

describe("sanitizeTicketBody — fence hygiene (MD031/MD040)", () => {
  test("blank-separates an opening fence glued to a paragraph and tags bare fences", () => {
    const out = sanitizeTicketBody("para:\n```\ncode\n```");
    // blank before AND after the block, `text` tag added
    expect(out).toBe("para:\n\n```text\ncode\n```");
  });

  test("keeps an existing language tag and preserves blank separators", () => {
    const out = sanitizeTicketBody("a\n\n```ts\nconst x = 1;\n```\n\nb");
    expect(out).toBe("a\n\n```ts\nconst x = 1;\n```\n\nb");
  });

  test("leaves fence content verbatim (no token escaping inside code)", () => {
    const out = sanitizeTicketBody("```\nconst re = /<path>/;\n```");
    expect(out).toContain("const re = /<path>/;");
  });

  test("trims trailing whitespace outside fences — fence content untouched (MD009/MD010)", () => {
    const out = sanitizeTicketBody("para:   \n\ntext   \n```\ncode  \n```\nnext   ");
    expect(out).toBe("para:\n\ntext\n\n```text\ncode  \n```\n\nnext");
  });
});

describe("sanitizeTicketBody — lists (MD032)", () => {
  test("inserts a blank line between a paragraph and a following list", () => {
    const out = sanitizeTicketBody("steps:\n- one\n- two\n1. three");
    expect(out).toBe("steps:\n\n- one\n- two\n1. three");
  });

  test("leaves lists that already have their blank separator", () => {
    expect(sanitizeTicketBody("steps:\n\n- one")).toBe("steps:\n\n- one");
  });
});

describe("sanitizeTicketBody — bare angle tokens (MD033)", () => {
  test("inlines placeholder tokens as code", () => {
    expect(sanitizeTicketBody("runs `giwt remove <path>`-style targets: <file> and <owner/repo>"))
      .toBe("runs `giwt remove <path>`-style targets: `<file>` and `<owner/repo>`");
  });

  test("preserves already-backticked tokens, autolinks, and HTML comments", () => {
    const line = "keep `<path>` here, see <https://example.com/x>, <!-- note -->";
    expect(sanitizeTicketBody(line)).toBe(line);
  });
});

describe("sanitizeTicketBody — blank runs and edges (MD012)", () => {
  test("collapses interior blank runs, strips blank edges, no trailing newline", () => {
    expect(sanitizeTicketBody("\n\na\n\n\n\nb\n\n\n")).toBe("a\n\nb");
  });

  test("empty body stays empty", () => {
    expect(sanitizeTicketBody("")).toBe("");
    expect(sanitizeTicketBody("\n\n")).toBe("");
  });
});

describe("detectNestedTicketDoc — whole-document bodies", () => {
  const NESTED = [
    "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->",
    "<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->",
    "",
    "# BUG: nested ticket",
    "",
    "**Status:** In Progress",
    "",
    "body prose",
  ].join("\n");

  test("flags SPDX header, own title heading, and Status block", () => {
    const markers = detectNestedTicketDoc(NESTED);
    expect(markers).toHaveLength(3);
    expect(markers[0]).toContain("SPDX");
    expect(markers[1]).toContain("'# <TYPE>");
    expect(markers[2]).toContain("**Status:**");
  });

  test("accepts prose bodies that merely carry section fields", () => {
    expect(detectNestedTicketDoc("**Context:**\n\nsome context\n\n- a point")).toEqual([]);
    expect(detectNestedTicketDoc("plain prose about **status** as words")).toEqual([]);
  });

  test("ignores marker shapes inside fenced code", () => {
    const body = "probe output:\n\n```text\n# not a title\n**Status:** not a block\n```";
    expect(detectNestedTicketDoc(body)).toEqual([]);
  });
});
