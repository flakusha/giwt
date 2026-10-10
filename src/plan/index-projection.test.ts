// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ported from loop-lore's normalize-plan-metadata.test.ts (index-projection
 * half): canonicalIndexOrder + projectIndex, including the documented
 * stale-tag RETENTION semantic (a deleted Tags line never clears a ticket's
 * tags) and the frontmatter-wins divergence repair.
 */
import { describe, expect, test } from "bun:test";
import { canonicalIndexOrder, projectIndex } from "./index-projection";

describe("canonicalIndexOrder", () => {
  test("uses localeCompare order, matching what giwt writes", () => {
    // The real index holds both casings and giwt's localeCompare keeps the
    // lowercase key FIRST (case is a tertiary collation level). The default
    // code-unit sort puts uppercase first and moved it — the spurious reorder
    // this function exists to prevent.
    const index = {
      "BUG-REDOS-IN-A": {},
      "BUG-redos-in-a": {},
      "BUG-REDUNDANT": {},
    };
    expect(Object.keys(canonicalIndexOrder(index))).toEqual([
      "BUG-redos-in-a",
      "BUG-REDOS-IN-A",
      "BUG-REDUNDANT",
    ]);
  });

  test("an already-canonical index round-trips unchanged", () => {
    const index = { "BUG-A": {}, "BUG-redos-in-a": {}, "BUG-REDUNDANT": {} };
    expect(canonicalIndexOrder(index)).toEqual(index);
  });

  test("sorting a sorted index is a fixed point", () => {
    const once = canonicalIndexOrder({ "B": {}, "a": {}, "C-1": {} });
    expect(canonicalIndexOrder(once)).toEqual(once);
  });
});

describe("projectIndex", () => {
  const files: Record<string, string> = {
    ".plan/tickets/BUG-001.md": "**Tags:** chat, bug\n**Epic:** epic-items\n",
    ".plan/tickets/BUG-002.md": "**Status:** Done\n",
    ".plan/tickets/BUG-003.md": "**Tags:** already\n**Epic:** epic-other\n",
    ".plan/tickets/BUG-006.md": "**Tags:** fresh-list\n**Epic:** epic-new\n",
  };
  const read = (src: string): string | null => files[src] ?? null;
  const index = {
    "BUG-001": { source: ".plan/tickets/BUG-001.md", tags: [], epic: "" },
    "BUG-002": { source: ".plan/tickets/BUG-002.md", tags: [], epic: "" },
    "BUG-003": {
      source: ".plan/tickets/BUG-003.md",
      tags: ["` lines) but are **not** propagated", "fragments", "from prose"],
      epic: "epic-other",
    },
    "BUG-004": { source: ".plan/tickets/BUG-gone.md", tags: [], epic: "" },
    "BUG-005": { source: "", tags: [], epic: "" },
    "BUG-006": { source: ".plan/tickets/BUG-006.md", tags: ["stale"], epic: "epic-old" },
  };

  test("backfill: fills empty tags/epic from the .md, counting each", () => {
    const { next, tagsFilled, epicsFilled } = projectIndex(index, read);
    expect(next["BUG-001"]).toEqual({
      source: ".plan/tickets/BUG-001.md",
      tags: ["chat", "bug"],
      epic: "epic-items",
    });
    expect({ tagsFilled, epicsFilled }).toEqual({ tagsFilled: 3, epicsFilled: 1 });
  });

  test("retention: a ticket whose Tags line is gone keeps its stale tags — nothing inferred", () => {
    // Documented semantic, ported verbatim-in-spirit from loop-lore: a .md
    // with no Tags line leaves the entry untouched. Deleting the Tags line
    // must never silently clear an index entry's tags — the projection has
    // no way to distinguish "author removed tagging" from "tags live
    // elsewhere", so it retains instead of destroying.
    const { next } = projectIndex(index, read);
    expect(next["BUG-002"]).toEqual(index["BUG-002"]);
  });

  test("frontmatter-wins repair: prose-fragment tags scraped by a header-window parse are replaced by the .md list", () => {
    const { next } = projectIndex(index, read);
    expect(next["BUG-003"]).toEqual({
      source: ".plan/tickets/BUG-003.md",
      tags: ["already"],
      epic: "epic-other",
    });
  });

  test("epic stays fill-only-empty — a differing epic value is never overwritten", () => {
    const { next, epicsFilled } = projectIndex(index, read);
    expect(next["BUG-006"]).toEqual({
      source: ".plan/tickets/BUG-006.md",
      tags: ["fresh-list"],
      epic: "epic-old",
    });
    expect(epicsFilled).toBe(1);
  });

  test("skips an entry whose source is missing or empty", () => {
    const { next, tagsFilled } = projectIndex(index, read);
    expect(next["BUG-004"]).toEqual(index["BUG-004"]);
    expect(next["BUG-005"]).toEqual(index["BUG-005"]);
    expect(tagsFilled).toBe(3);
  });

  test("is idempotent — a second projection changes nothing", () => {
    const once = projectIndex(index, read).next;
    const twice = projectIndex(once, read);
    expect(twice.tagsFilled).toBe(0);
    expect(twice.epicsFilled).toBe(0);
    expect(twice.next).toEqual(once);
  });
});
