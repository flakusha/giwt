// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickEpicOwner, scanEpicTitles, splitEpicCandidates } from "./epic-owner-pick";

const SLUGS = new Set([
  "epic-chat-lifecycle-moderation",
  "epic-assistant-gm-flows",
  "epic-housing",
  "epic-housing-base-building",
  "epic-character-core-system",
  "epic-immersion-presentation",
  "epic-visual-novel-mode",
  "epic-aux-enrichment-pipeline",
  "epic-avatar-alpha-vn-layering",
  "epic-wardrobe-avatar-variants",
]);

const TITLES: Record<string, string> = {
  "Character Core System": "epic-character-core-system",
  "Immersion & Presentation": "epic-immersion-presentation",
  "Avatar Alpha Channel + VN Layering": "epic-avatar-alpha-vn-layering",
};

describe("splitEpicCandidates", () => {
  test("comma list splits in author order", () => {
    expect(splitEpicCandidates("epic-assistant-gm-flows, epic-chat-lifecycle-moderation"))
      .toEqual(["epic-assistant-gm-flows", "epic-chat-lifecycle-moderation"]);
  });

  test("slash list splits; slash inside parens does not", () => {
    expect(splitEpicCandidates("epic-housing (umbrella) / epic-housing-base-building (design)"))
      .toEqual(["epic-housing", "epic-housing-base-building"]);
    expect(splitEpicCandidates("Asset Platform Capabilities (Messenger/Social Patterns)"))
      .toEqual(["Asset Platform Capabilities"]);
  });

  test("semicolon splits; .md suffix and backticks strip", () => {
    expect(
      splitEpicCandidates(
        "`epic-logging-telemetry.md` (logging), `epic-aux-enrichment-pipeline.md` (storage)",
      ),
    )
      .toEqual(["epic-logging-telemetry", "epic-aux-enrichment-pipeline"]);
    expect(splitEpicCandidates("Emotion Avatar Message Binding; Visual Novel Mode"))
      .toEqual(["Emotion Avatar Message Binding", "Visual Novel Mode"]);
  });

  test("+ joins candidates only with parenthetical role notes", () => {
    expect(splitEpicCandidates("epic-a.md (research) + epic-b.md (impl)"))
      .toEqual(["epic-a", "epic-b"]);
    expect(splitEpicCandidates("Avatar Alpha Channel + VN Layering"))
      .toEqual(["Avatar Alpha Channel + VN Layering"]);
  });
});

describe("pickEpicOwner", () => {
  test("first existing slug wins", () => {
    expect(pickEpicOwner("epic-assistant-gm-flows, epic-chat-lifecycle-moderation", SLUGS, TITLES))
      .toBe("epic-assistant-gm-flows");
    expect(pickEpicOwner("epic-chat-lifecycle-moderation, epic-assistant-gm-flows", SLUGS, TITLES))
      .toBe("epic-chat-lifecycle-moderation");
  });

  test("skips a dangling first candidate for the first that resolves", () => {
    expect(pickEpicOwner("epic-missing, epic-housing", SLUGS, TITLES)).toBe("epic-housing");
  });

  test("exact legacy title resolves; near-miss does not", () => {
    expect(pickEpicOwner("Character Core System", SLUGS, TITLES)).toBe(
      "epic-character-core-system",
    );
    expect(pickEpicOwner("Avatar Alpha Channel + VN Layering", SLUGS, TITLES))
      .toBe("epic-avatar-alpha-vn-layering");
    expect(pickEpicOwner("character core system", SLUGS, TITLES)).toBeNull();
  });

  test("title/slug mix resolves through the table", () => {
    expect(pickEpicOwner("Avatar Alpha Channel + VN Layering; Visual Novel Mode", SLUGS, TITLES))
      .toBe("epic-avatar-alpha-vn-layering");
  });

  test("whole-value exact title wins over splitting on its separator", () => {
    expect(pickEpicOwner("Wardrobe / Loadout Avatar Variants", SLUGS, {
      ...TITLES,
      "Wardrobe / Loadout Avatar Variants": "epic-wardrobe-avatar-variants",
    })).toBe("epic-wardrobe-avatar-variants");
  });

  test("unresolvable values return null", () => {
    expect(pickEpicOwner("NPC/Actor System, NPC Navigation", SLUGS, TITLES)).toBeNull();
    expect(pickEpicOwner("proposed:epic-3d-avatars", SLUGS, TITLES)).toBeNull();
    expect(pickEpicOwner("Epic 26 (Avatar & Expression)", SLUGS, TITLES)).toBeNull();
    expect(pickEpicOwner("(none)", SLUGS, TITLES)).toBeNull();
    expect(pickEpicOwner("", SLUGS, TITLES)).toBeNull();
  });

  test("already-canonical single slug passes through", () => {
    expect(pickEpicOwner("epic-housing", SLUGS, TITLES)).toBe("epic-housing");
  });
});

function scanFixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "epic-owner-pick-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), body);
    }
    return scanEpicTitles(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("scanEpicTitles", () => {
  test("reads both H1 dialects off disk", () => {
    const { titles, ambiguous } = scanFixture({
      "epic-character-core-system.md": "# EPIC: Character Core System\n",
      "epic-nsfw-game-mechanics.md": "# Epic: AO NSFW Game Mechanics\n",
      "epic-no-heading.md": "just prose\n",
      "README.md": "# EPIC: Not An Epic\n",
    });
    expect(titles["Character Core System"]).toBe("epic-character-core-system");
    expect(titles["AO NSFW Game Mechanics"]).toBe("epic-nsfw-game-mechanics");
    expect(Object.keys(titles).length).toBe(2);
    expect(ambiguous).toEqual([]);
  });

  test("duplicate titles keep the first file and report the rest", () => {
    const { titles, ambiguous } = scanFixture({
      "epic-a-frontend-internationalization.md": "# EPIC: Internationalization (i18n)\n",
      "epic-b-frontend-i18n.md": "# EPIC: Internationalization (i18n)\n",
      "epic-c-unrelated.md": "# EPIC: Unrelated\n",
    });
    expect(titles["Internationalization (i18n)"]).toBe("epic-a-frontend-internationalization");
    expect(titles["Unrelated"]).toBe("epic-c-unrelated");
    expect(ambiguous.length).toBe(1);
    expect(ambiguous[0]).toContain("Internationalization (i18n)");
    expect(ambiguous[0]).toContain("epic-b-frontend-i18n");
  });

  test("a duplicate spanning the two H1 dialects is reported once", () => {
    const { titles, ambiguous } = scanFixture({
      "epic-a-dup.md": "# EPIC: Shared Title\n",
      "epic-b-dup.md": "# Epic: Shared Title\n",
    });
    expect(titles["Shared Title"]).toBe("epic-a-dup");
    expect(ambiguous.length).toBe(1);
    expect(ambiguous[0]).toContain("epic-b-dup");
  });
});
