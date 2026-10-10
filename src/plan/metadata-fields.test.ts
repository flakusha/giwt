// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ported from loop-lore's normalize-plan-metadata.test.ts (rewrite-layer
 * half): fieldLines / normalizeEpicRef / planFile / applyRewrites /
 * relatedRefs. The index-projection half lives in index-projection.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  applyRewrites,
  fieldLines,
  normalizeEpicRef,
  planFile,
  relatedRefs,
} from "./metadata-fields";

const SLUGS = new Set(["epic-items", "epic-frontend-components", "epic-api-versioning"]);
const FILE = ".plan/tickets/BUG-x.md";

describe("normalizeEpicRef", () => {
  test("accepts the spellings tickets actually use", () => {
    expect(normalizeEpicRef("epic-items")).toBe("epic-items");
    expect(normalizeEpicRef("epic-api-versioning.md")).toBe("epic-api-versioning");
    expect(normalizeEpicRef("`epic-items`")).toBe("epic-items");
    expect(normalizeEpicRef(".plan/epics/epic-items.md")).toBe("epic-items");
    expect(normalizeEpicRef("epic-items.md (MVP Tier 1)")).toBe("epic-items");
    expect(normalizeEpicRef("`epic-assistant-creative-studio-workflows` (§7.6)")).toBe(
      "epic-assistant-creative-studio-workflows",
    );
  });

  test("refuses values that name no single epic", () => {
    // Placeholders and freeform prose are NOT epic references — guessing
    // here is how a wrong binding gets invented.
    expect(normalizeEpicRef("")).toBeNull();
    expect(normalizeEpicRef("(if applicable)")).toBeNull();
    expect(normalizeEpicRef("(none)")).toBeNull();
    expect(normalizeEpicRef("AO NSFW Game Mechanics")).toBeNull();
    expect(normalizeEpicRef("Epic 26 (Avatar & Expression)")).toBeNull();
    expect(normalizeEpicRef("proposed:epic-attachment-moderation")).toBeNull();
    expect(normalizeEpicRef("epic-chat-lifecycle-moderation, epic-assistant-gm-flows")).toBeNull();
    expect(normalizeEpicRef("epic-items / epic-rpg")).toBeNull();
  });
});

describe("fieldLines", () => {
  test("reads all three field spellings without eating the closing bold", () => {
    const got = fieldLines(
      ["**Epic:** epic-items", "**Epic**: epic-items", "**Tags:** a, b", "**Labels**: c, d"].join(
        "\n",
      ),
    );
    expect(got.map((f) => [f.name, f.value])).toEqual([
      ["Epic", "epic-items"],
      ["Epic", "epic-items"],
      ["Tags", "a, b"],
      ["Labels", "c, d"],
    ]);
  });

  test("an empty field line yields an empty value, not the next field", () => {
    // The blob-matching bug this guards: a 30-line join reads a
    // `**Related**:` line directly under an empty `**Epic**:` as the
    // epic's value.
    const got = fieldLines(["**Epic**:", "**Related**: FEAT-036"].join("\n"));
    expect(got.map((f) => [f.name, f.value])).toEqual([["Epic", ""]]);
  });

  test("does not match status or unrelated lines", () => {
    expect(fieldLines("**Status:** Done").length).toBe(0);
    expect(fieldLines("**Summary:** Tags: Labels").length).toBe(0);
  });
});

describe("planFile", () => {
  test("promotes a populated **Labels:** line to **Tags:**, value intact", () => {
    const plan = planFile(FILE, "**Labels**: chat, bug, mode\n", SLUGS);
    expect(plan.rewrites).toEqual([{
      file: FILE,
      kind: "labels-to-tags",
      from: "**Labels**: chat, bug, mode",
      to: "**Tags**: chat, bug, mode",
    }]);
    expect(plan.hasTags).toBe(true);
  });

  test("leaves a placeholder Labels value alone — `(none)` is not a tag", () => {
    const plan = planFile(FILE, "**Labels**: (none)\n", SLUGS);
    expect(plan.rewrites).toEqual([]);
    expect(plan.hasTags).toBe(false);
  });

  test("canonicalizes the colon-outside Epic spelling so sync-parse can read it", () => {
    const plan = planFile(FILE, "**Epic**: epic-items\n", SLUGS);
    expect(plan.rewrites).toEqual([{
      file: FILE,
      kind: "epic-colon-outside",
      from: "**Epic**: epic-items",
      to: "**Epic:** epic-items",
    }]);
    expect(plan.dangling).toEqual([]);
  });

  test("does not rewrite an already-canonical Epic line", () => {
    const plan = planFile(FILE, "**Epic:** epic-items\n", SLUGS);
    expect(plan.rewrites).toEqual([]);
  });

  test("reports an epic that names no epic file instead of inventing one", () => {
    const plan = planFile(FILE, "**Epic:** epic-does-not-exist\n", SLUGS);
    expect(plan.rewrites).toEqual([]);
    expect(plan.dangling).toEqual([{ file: FILE, value: "epic-does-not-exist" }]);
  });

  test("a file with no tags and no labels stays untagged", () => {
    const plan = planFile(FILE, "**Status:** Done\n**Priority:** high\n", SLUGS);
    expect(plan.rewrites).toEqual([]);
    expect(plan.hasTags).toBe(false);
  });
});

describe("applyRewrites", () => {
  test("preserves status lines byte-for-byte", () => {
    const text = [
      "**Status:** ✅ Complete",
      "**Priority:** high",
      "**Labels**: chat, bug",
      "**Epic**: epic-items",
      "",
      "Body mentioning **Tags:** in prose.",
    ].join("\n");
    const plan = planFile(FILE, text, SLUGS);
    const out = applyRewrites(text, plan.rewrites);
    expect(out.split("\n")[0]).toBe("**Status:** ✅ Complete");
    expect(out.split("\n")[1]).toBe("**Priority:** high");
    expect(out.split("\n")[2]).toBe("**Tags**: chat, bug");
    expect(out.split("\n")[3]).toBe("**Epic:** epic-items");
    // A prose mention in the body is not a header field: untouched.
    expect(out.split("\n")[5]).toBe("Body mentioning **Tags:** in prose.");
  });

  test("is idempotent — a normalized file is a fixed point", () => {
    const text = "**Status:** Done\n**Labels**: chat, bug\n**Epic**: epic-items\n";
    const once = applyRewrites(text, planFile(FILE, text, SLUGS).rewrites);
    const twice = planFile(FILE, once, SLUGS).rewrites;
    expect(twice).toEqual([]);
    expect(applyRewrites(once, twice)).toBe(once);
  });
});

describe("relatedRefs", () => {
  const known = new Set(["BUG-002", "epic-items", "FEAT-036"]);

  test("resolves a type-prefixed id against the known slugs", () => {
    expect(relatedRefs("**Related**: FEAT-036, BUG-002.md", known).refs).toEqual([
      "FEAT-036",
      "BUG-002.md",
    ]);
  });

  test("reports a ref that names no file instead of guessing", () => {
    expect(relatedRefs("**Related:** BUG-999.md", known).dangling).toEqual(["BUG-999.md"]);
  });

  test("prose in the field is not mistaken for a ref", () => {
    const { refs, dangling } = relatedRefs(
      "**Related:** same telemetry surface, see `src/admin/config-keys.ts:91`",
      known,
    );
    expect(refs).toEqual([]);
    expect(dangling).toEqual([]);
  });

  test("a file with no Related line yields nothing", () => {
    expect(relatedRefs("**Status:** Done\n", known)).toEqual({ refs: [], dangling: [] });
  });
});
