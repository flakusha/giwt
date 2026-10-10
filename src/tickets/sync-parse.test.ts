// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Regression coverage for ticket .md metadata-field parsing
 * (src/tickets/sync-parse.ts), focused on the FIX-sync-parse-first-bold-
 * colon-match anchoring contract: LINE-ANCHORED field matching over the
 * whole file, FIRST match wins, so body prose that re-spells a field can
 * never pollute index fields and a metadata block that drifted past line 30
 * still parses.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { parseEpicField, parseTagsField, parseTicketFile, parseTicketText } from "./sync-parse";

function tempDir(): string {
  return mkdtempSync(join(scratchRoot(), "giwt-sync-parse-"));
}

describe("field anchoring — body prose re-spelling", () => {
  test("a Context paragraph re-spelling Tags/Epic verbatim cannot pollute fields", () => {
    const md = [
      "# TASK-PROSE: Prose re-spelling",
      "",
      "**Status:** open",
      "**Priority:** high",
      "**Epic:** EPIC-REAL",
      "**Tags:** alpha, beta",
      "",
      "**Context:**",
      "",
      "The legacy config used a literal `**Tags:** gamma, delta` marker and the",
      "epic header string **Epic:** EPIC-GHOST appeared in a quoted snippet.",
      "",
      "Standalone line re-spelling:",
      "",
      "**Tags:** prose-one, prose-two, prose-three, prose-four, prose-five, prose-six",
      "",
      "git issue: abc1234",
    ].join("\n");
    const tf = parseTicketText(md, "TASK-PROSE.md");
    expect(tf).not.toBeNull();
    expect(tf!.tags).toEqual(["alpha", "beta"]);
    expect(tf!.epic).toBe("EPIC-REAL");
    expect(tf!.priority).toBe("high");
  });

  test("re-spelling embedded mid-sentence is not line-anchored and is ignored", () => {
    const md = [
      "# TASK-INLINE: Inline mention",
      "",
      "**Status:** open",
      "**Epic:** EPIC-TRUE",
      "",
      "Back in the day we wrote **Epic:** EPIC-STALE inline inside sentences.",
    ].join("\n");
    expect(parseTicketText(md, "x.md")!.epic).toBe("EPIC-TRUE");
  });

  test("a metadata block sitting late in the header region still parses", () => {
    const lines = ["# TASK-LATE: Late block", ""];
    while (lines.length < 25) lines.push("filler prose line");
    lines.push(
      "**Status:** open",
      "**Priority:** low",
      "**Epic:** EPIC-LATE",
      "**Tags:** late-tag",
    );
    const tf = parseTicketText(lines.join("\n"), "TASK-LATE.md");
    expect(tf).not.toBeNull();
    expect(tf!.priority).toBe("low");
    expect(tf!.epic).toBe("EPIC-LATE");
    expect(tf!.tags).toEqual(["late-tag"]);
  });

  test("field-shaped prose beyond the header region does not pollute fields", () => {
    const lines = ["# TASK-FAR: Far prose", "", "**Status:** open", "**Priority:** high"];
    while (lines.length < 35) lines.push("filler prose line");
    lines.push("**Epic:** EPIC-BEYOND", "**Tags:** beyond-tag");
    const tf = parseTicketText(lines.join("\n"), "TASK-FAR.md");
    expect(tf!.epic).toBe("");
    expect(tf!.tags).toEqual([]);
    expect(tf!.priority).toBe("high");
  });

  test("duplicate field lines — the FIRST (topmost) line wins", () => {
    const md = [
      "# TASK-DUP: Duplicate fields",
      "",
      "**Status:** open",
      "**Priority:** high",
      "**Epic:** EPIC-FIRST",
      "**Tags:** first",
      "",
      "**Priority:** low",
      "**Epic:** EPIC-SECOND",
      "**Tags:** second",
    ].join("\n");
    const tf = parseTicketText(md, "TASK-DUP.md");
    expect(tf!.priority).toBe("high");
    expect(tf!.epic).toBe("EPIC-FIRST");
    expect(tf!.tags).toEqual(["first"]);
  });
});

describe("field anchoring — negative space", () => {
  test("no Tags line at all yields an empty tag list and defaults", () => {
    const tf = parseTicketText("# TASK-NOTAGS: No tags\n\n**Status:** open\n", "x.md");
    expect(tf!.tags).toEqual([]);
    expect(tf!.epic).toBe("");
    expect(tf!.priority).toBe("medium");
  });

  test("an empty Tags value yields an empty tag list, not ['']", () => {
    const tf = parseTicketText("# TASK-EMPTYTAGS: Empty\n\n**Tags:**\n", "x.md");
    expect(tf!.tags).toEqual([]);
  });

  test("list/quote-prefixed field lines still parse (STATUS_LINE_RE parity)", () => {
    const md = "# TASK-LIST: List prefix\n\n- **Epic:** EPIC-LISTED\n> **Tags:** quoted\n";
    expect(parseTicketText(md, "x.md")!.epic).toBe("EPIC-LISTED");
    expect(parseTagsField(md)).toEqual(["quoted"]);
  });
});

describe("shared field parsers (parseTagsField / parseEpicField)", () => {
  test("bracket/quote adornments are stripped from tag tokens", () => {
    expect(parseTagsField("**Tags:** [check, \"inference\", `worktree`]")).toEqual([
      "check",
      "inference",
      "worktree",
    ]);
  });

  test("both colon placements parse (colon inside or outside the bold)", () => {
    expect(parseEpicField("**Epic:** EPIC-A")).toBe("EPIC-A");
    expect(parseEpicField("**Epic**: EPIC-B")).toBe("EPIC-B");
    expect(parseTagsField("**Tags:** a, b")).toEqual(["a", "b"]);
    expect(parseTagsField("**Tags**: c")).toEqual(["c"]);
  });

  test("prose-embedded mentions return empty / []", () => {
    expect(parseEpicField("the **Epic:** GHOST string appeared inline")).toBe("");
    expect(parseTagsField("echoed `**Tags:** ghost` from the docs")).toEqual([]);
  });
});

describe("parseTicketFile end-to-end", () => {
  test("real file with corrupting prose parses the real header values", () => {
    const dir = tempDir();
    try {
      const path = join(dir, "TASK-FILE.md");
      const md = [
        "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->",
        "",
        "# TASK: File fixture",
        "",
        "**Status:** In Progress",
        "**Priority:** high",
        "**Epic:** EPIC-FILE",
        "**Tags:** one, two",
        "",
        "**Summary:**",
        "",
        "Evidence mentioned a literal **Tags:** fake, fake-two marker in prose.",
      ].join("\n");
      writeFileSync(path, `${md}\n`);
      const tf = parseTicketFile(path, ".plan/tickets/TASK-FILE.md");
      expect(tf).not.toBeNull();
      expect(tf!.title).toBe("File fixture");
      expect(tf!.status).toBe("in_progress");
      expect(tf!.priority).toBe("high");
      expect(tf!.epic).toBe("EPIC-FILE");
      expect(tf!.tags).toEqual(["one", "two"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
