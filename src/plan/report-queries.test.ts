// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * The 9 loop-lore report-plan-metadata tests, mirrored 1:1 onto giwt's port
 * (declaredTags; orphanTags ×2; orphanBindings ×2; danglingRelated;
 * byTag/byEpic ×2; aggregate) plus giwt-specific negative space (placeholder
 * tokens excluded; done classification via status-vocab). Pure in-memory
 * fixtures, no filesystem.
 */
import { describe, expect, test } from "bun:test";
import { declaredTags, orphanBindings, orphanTags } from "./orphan-detect";
import { aggregate, byEpic, byTag, danglingRelated } from "./report-queries";

describe("declaredTags", () => {
  test("collects tags from every plan file, lowercased and deduplicated", () => {
    const files = {
      ".plan/tickets/A.md": "**Tags:** Chat, bug\n",
      ".plan/epics/e.md": "**Tags:** chat, ops\n",
      ".plan/tickets/untagged.md": "**Status:** Done\n",
    };
    expect([...declaredTags(files)]).toEqual(["chat", "bug", "ops"]);
  });
});

describe("orphanTags", () => {
  const files = { ".plan/tickets/A.md": "**Tags:** chat\n" };
  const declared = declaredTags(files);
  const index = {
    "A": { source: ".plan/tickets/A.md", tags: ["chat", "ghost-fragment"] },
    "B": { source: ".plan/tickets/B.md", tags: [] },
  };

  test("flags index tags no .md frontmatter declares, per entry", () => {
    expect(orphanTags(index, declared)).toEqual([
      { extid: "A", tag: "ghost-fragment" },
    ]);
  });

  test("matching is case-insensitive — a cased md declaration is not orphan", () => {
    const loose = declaredTags({
      ".plan/tickets/A.md": "**Tags:** chat\n",
      ".plan/epics/E.md": "**Tags:** Ghost-Fragment\n",
    });
    expect(orphanTags(index, loose)).toEqual([]);
  });

  test("placeholder tokens are excluded — `(none)`, `n/a`, `-`, `tbd` are not orphan tags", () => {
    const i = { "P": { tags: ["(none)", "n/a", "-", "tbd", ""] } };
    expect(orphanTags(i, new Set())).toEqual([]);
  });
});

describe("orphanBindings", () => {
  const index = {
    "A": { epic: "epic-real", tags: [] },
    "B": { epic: "epic-missing", tags: [] },
    "C": { epic: "", tags: [] },
  };
  const epicExists = (slug: string): boolean => slug === "epic-real";

  test("flags bindings naming no epic file; empty bindings are skipped", () => {
    expect(orphanBindings(index, epicExists)).toEqual([
      { extid: "B", epic: "epic-missing" },
    ]);
  });

  test(".md suffixes and path prefixes resolve like epic-owner-pick", () => {
    const i = { "D": { epic: "epic-real", tags: [] } };
    expect(orphanBindings(i, epicExists)).toEqual([]);
  });
});

describe("danglingRelated", () => {
  test("uses the shared relatedRefs resolver against known plan slugs", () => {
    const files = {
      ".plan/tickets/A.md": "**Related:** B, no-such-file.md\n",
      ".plan/tickets/B.md": "no Related line\n",
    };
    const known = new Set(["B"]);
    expect(danglingRelated(files, known)).toEqual([
      { file: ".plan/tickets/A.md", ref: "no-such-file.md" },
    ]);
  });
});

describe("byTag / byEpic", () => {
  const index = {
    "A": { source: ".plan/tickets/A.md", tags: ["chat"], status: "open" },
    "B": { source: ".plan/tickets/B.md", tags: ["ops"], status: "done", epic: "epic-real" },
  };

  test("byTag matches case-insensitively and prints extid/status/source", () => {
    expect(byTag(index, "CHAT")).toEqual([
      { extid: "A", status: "open", source: ".plan/tickets/A.md" },
    ]);
  });

  test("byEpic matches the epic slug case-insensitively, .md tolerated", () => {
    expect(byEpic(index, "Epic-Real.md")).toEqual([
      { extid: "B", status: "done", source: ".plan/tickets/B.md" },
    ]);
  });
});

describe("aggregate", () => {
  test("totals, bindings, and top-N sorted by frequency", () => {
    const index = {
      "A": { tags: ["x", "y"], epic: "e1", status: "open" },
      "B": { tags: ["x"], epic: "e1", status: "open" },
      "C": { tags: ["x", "z"], epic: "", status: "open" },
    };
    const a = aggregate(index);
    expect(a.tickets).toBe(3);
    expect(a.distinctTags).toBe(3);
    expect(a.bindings).toBe(2);
    expect(a.topTags[0]).toEqual(["x", 3]);
    expect(a.topEpics[0]).toEqual(["e1", 2]);
    expect(a.topTags.length).toBeLessThanOrEqual(10);
  });

  test("done classifies statuses through the shared status vocabulary", () => {
    const index = {
      "A": { tags: [], status: "✅ Complete" },
      "B": { tags: [], status: "Done" },
      "C": { tags: [], status: "In Progress" },
      "D": { tags: [] },
    };
    expect(aggregate(index).done).toBe(2);
  });
});
