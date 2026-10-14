// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertIndexUnedited, verifyIndexStamp, writeIndexStamp } from "../tickets/index-stamp";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import {
  pickEpicOwner,
  runEpicOwnerPick,
  scanEpicTitles,
  splitEpicCandidates,
} from "./epic-owner-pick";

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

// Resource contract (parallel-safe): the apply-path tests below each own a
// mkdtemp fixture repo; stdout is spied and restored per test.
let applyRoot = "";
afterEach(() => {
  if (applyRoot) rmSync(applyRoot, { recursive: true, force: true });
  applyRoot = "";
});

describe("runEpicOwnerPick — apply path", () => {
  const rootCases = (dir: string): WorktreeConfig => ({
    repoRoot: dir,
    worktreeRoot: dir,
    treeDir: join(dir, "tree"),
    settings: DEFAULT_SETTINGS,
  });

  function makeRepo(): string {
    const dir = applyRoot = mkdtempSync(join(tmpdir(), "epic-owner-pick-apply-"));
    mkdirSync(join(dir, ".plan", "epics"), { recursive: true });
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    writeFileSync(join(dir, ".plan", "epics", "epic-alpha.md"), "# EPIC: Alpha\n");
    const ticket = join(dir, ".plan", "tickets", "t.md");
    writeFileSync(ticket, "# TASK: t\n\n**Epic:** epic-alpha, epic-beta\n");
    const indexPath = join(dir, ".plan", "tickets", "index.json");
    writeFileSync(
      indexPath,
      JSON.stringify(
        { "TASK-1": { epic: "epic-alpha, epic-beta", source: ".plan/tickets/t.md" } },
        null,
        2,
      ) + "\n",
    );
    return dir;
  }

  test("--apply collapses the epic and leaves the stamp verdict ok", async () => {
    const dir = makeRepo();
    const indexPath = join(dir, ".plan", "tickets", "index.json");
    writeIndexStamp(indexPath);
    expect(verifyIndexStamp(indexPath)).toBe("ok");

    const chunks: string[] = [];
    const spy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as never,
    );
    try {
      await runEpicOwnerPick(["--apply"], rootCases(dir));
    } finally {
      spy.mockRestore();
    }

    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<
      string,
      { epic: string; }
    >;
    expect(index["TASK-1"]!.epic).toBe("epic-alpha");
    expect(readFileSync(join(dir, ".plan", "tickets", "t.md"), "utf8"))
      .toContain("**Epic:** epic-alpha\n");
    expect(verifyIndexStamp(indexPath)).toBe("ok");
    expect(() => assertIndexUnedited(indexPath)).not.toThrow();
  });

  test("a manually edited index is refused before any rewrite", async () => {
    const dir = makeRepo();
    const indexPath = join(dir, ".plan", "tickets", "index.json");
    writeIndexStamp(indexPath);
    writeFileSync(indexPath, "{ \"TASK-1\": {} }\n"); // out-of-band edit

    let error: unknown;
    try {
      await runEpicOwnerPick(["--apply"], rootCases(dir));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("manually edited");
    expect(readFileSync(indexPath, "utf8")).toBe("{ \"TASK-1\": {} }\n");
  });

  test("a repo with tickets but no .plan/epics/ dir does not crash", async () => {
    const dir = applyRoot = mkdtempSync(join(tmpdir(), "epic-owner-pick-noepics-"));
    mkdirSync(join(dir, ".plan", "tickets"), { recursive: true });
    const indexPath = join(dir, ".plan", "tickets", "index.json");
    writeFileSync(
      indexPath,
      JSON.stringify(
        { "TASK-1": { epic: "epic-alpha, epic-beta", source: ".plan/tickets/t.md" } },
        null,
        2,
      ) + "\n",
    );
    writeIndexStamp(indexPath);

    const chunks: string[] = [];
    const spy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as never,
    );
    try {
      await runEpicOwnerPick(["--apply"], rootCases(dir));
    } finally {
      spy.mockRestore();
    }

    // No epics to resolve against: nothing crashes and the value stays put
    // (unresolvable epic values are reported, never guessed).
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<
      string,
      { epic: string; }
    >;
    expect(index["TASK-1"]!.epic).toBe("epic-alpha, epic-beta");
  });
});
