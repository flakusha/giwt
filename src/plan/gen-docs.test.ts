// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/plan/gen-docs.ts — epic index generation.
 *
 * Resource contract (parallel-safe): every test owns a mkdtemp fixture.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectEpics, genDocs, generateIndex, parseEpic } from "./gen-docs";

interface Fixture {
  root: string;
  epicsDir: string;
  backlogPath: string;
  outPath: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-gendocs-"));
  const epicsDir = join(root, ".plan/epics");
  mkdirSync(epicsDir, { recursive: true });
  return {
    root,
    epicsDir,
    backlogPath: join(root, ".plan/backlog/open.md"),
    outPath: join(root, ".plan/epics-index.md"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const EPIC_CONTENT = `# EPIC: Auth Flow

**Status:** 🔄 In Progress
**Priority:** High
**Effort:** Large
**Type:** Feature
**Tags:** auth, security

## Overview

Implement authentication flow with JWT.

## Linked Tasks

- [ ] TASK-foo
- [ ] TASK-bar
`;

const EPIC_COMPLETE = `# EPIC: Database Migration

**Status:** ✅ Complete
**Priority:** Medium
**Effort:** Medium
**Type:** Infrastructure
**Tags:** db

## Overview

Migrate from Postgres to SQLite.

## Linked Tasks

- [x] TASK-done
`;

// ── parseEpic ───────────────────────────────────────────────────

describe("parseEpic", () => {
  test("parses a well-formed epic", () => {
    const fx = makeFixture();
    try {
      const path = join(fx.epicsDir, "epic-auth.md");
      writeFileSync(path, EPIC_CONTENT);
      const epic = parseEpic(path);
      expect(epic).not.toBeNull();
      expect(epic!.file).toBe("epic-auth.md");
      expect(epic!.title).toBe("Auth Flow");
      expect(epic!.status).toBe("🔄 In Progress");
      expect(epic!.priority).toBe("High");
      expect(epic!.effort).toBe("Large");
      expect(epic!.type).toBe("Feature");
      expect(epic!.tags).toEqual(["auth", "security"]);
      expect(epic!.overview).toBe("Implement authentication flow with JWT.");
      expect(epic!.taskCount).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test("falls back to filename for missing title", () => {
    const fx = makeFixture();
    try {
      const path = join(fx.epicsDir, "epic-no-title.md");
      writeFileSync(path, "**Status:** 📋 Planned\n");
      const epic = parseEpic(path);
      expect(epic!.title).toBe("epic-no-title");
    } finally {
      fx.cleanup();
    }
  });

  test("defaults to Unknown for missing metadata", () => {
    const fx = makeFixture();
    try {
      const path = join(fx.epicsDir, "epic-minimal.md");
      writeFileSync(path, "# EPIC: Minimal\n\nNo metadata\n");
      const epic = parseEpic(path);
      expect(epic!.status).toBe("Unknown");
      expect(epic!.priority).toBe("Unknown");
      expect(epic!.effort).toBe("Unknown");
      expect(epic!.type).toBe("Unknown");
      expect(epic!.tags).toEqual([]);
      expect(epic!.taskCount).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("counts unchecked tasks only", () => {
    const fx = makeFixture();
    try {
      const path = join(fx.epicsDir, "epic-tasks.md");
      writeFileSync(
        path,
        "# EPIC: Tasks\n\n## Linked Tasks\n\n- [ ] TASK-one\n- [x] TASK-two\n- [ ] TASK-three\n",
      );
      const epic = parseEpic(path);
      expect(epic!.taskCount).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test("handles empty tags field", () => {
    const fx = makeFixture();
    try {
      const path = join(fx.epicsDir, "epic-notags.md");
      writeFileSync(path, "# EPIC: No Tags\n\n**Status:** 📋 Planned\n**Tags:**\n");
      const epic = parseEpic(path);
      expect(epic!.tags).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("extracts overview from ## Overview section", () => {
    const fx = makeFixture();
    try {
      const path = join(fx.epicsDir, "epic-ov.md");
      writeFileSync(
        path,
        "# EPIC: OV\n\n## Overview\n\nFirst paragraph here.\n\nSecond paragraph.\n\n## Details\n\nMore stuff.\n",
      );
      const epic = parseEpic(path);
      expect(epic!.overview).toBe("First paragraph here.");
    } finally {
      fx.cleanup();
    }
  });

  test("returns empty overview when no ## Overview section", () => {
    const fx = makeFixture();
    try {
      const path = join(fx.epicsDir, "epic-noov.md");
      writeFileSync(path, "# EPIC: No OV\n\n**Status:** 📋 Planned\n");
      const epic = parseEpic(path);
      expect(epic!.overview).toBe("");
    } finally {
      fx.cleanup();
    }
  });
});

// ── collectEpics ───────────────────────────────────────────────

describe("collectEpics", () => {
  test("collects all epic-*.md files", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.epicsDir, "epic-auth.md"), EPIC_CONTENT);
      writeFileSync(join(fx.epicsDir, "epic-db.md"), EPIC_COMPLETE);
      writeFileSync(join(fx.epicsDir, "not-epic.md"), "# Not an epic\n");
      const epics = collectEpics(fx.epicsDir);
      expect(epics).toHaveLength(2);
    } finally {
      fx.cleanup();
    }
  });

  test("sorts by status then title", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.epicsDir, "epic-z.md"), EPIC_COMPLETE); // ✅ Complete
      writeFileSync(join(fx.epicsDir, "epic-a.md"), EPIC_CONTENT); // 🔄 In Progress
      const epics = collectEpics(fx.epicsDir);
      // In Progress (0) before Complete (3)
      expect(epics[0]!.title).toBe("Auth Flow");
      expect(epics[1]!.title).toBe("Database Migration");
    } finally {
      fx.cleanup();
    }
  });

  test("returns empty for non-existent directory", () => {
    expect(collectEpics("/nonexistent")).toEqual([]);
  });

  test("returns empty for empty directory", () => {
    const fx = makeFixture();
    try {
      expect(collectEpics(fx.epicsDir)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ── generateIndex ───────────────────────────────────────────────

describe("generateIndex", () => {
  test("generates markdown with summary table", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.epicsDir, "epic-auth.md"), EPIC_CONTENT);
      const epics = collectEpics(fx.epicsDir);
      const md = generateIndex(epics, fx.backlogPath);
      expect(md).toContain("# Epics Index");
      expect(md).toContain("**Total:** 1 epics");
      expect(md).toContain("## Summary");
      expect(md).toContain("| Status | Title | Priority | Effort | Tasks | File |");
      expect(md).toContain("Auth Flow");
      expect(md).toContain("## Epics");
      expect(md).toContain("### Auth Flow");
    } finally {
      fx.cleanup();
    }
  });

  test("includes backlog reference when backlog exists", () => {
    const fx = makeFixture();
    try {
      mkdirSync(join(fx.root, ".plan/backlog"), { recursive: true });
      writeFileSync(fx.backlogPath, "# Backlog\n");
      const epics = collectEpics(fx.epicsDir);
      const md = generateIndex(epics, fx.backlogPath);
      expect(md).toContain("## Backlog");
    } finally {
      fx.cleanup();
    }
  });

  test("omits backlog reference when no backlog", () => {
    const fx = makeFixture();
    try {
      const epics = collectEpics(fx.epicsDir);
      const md = generateIndex(epics, fx.backlogPath);
      expect(md).not.toContain("## Backlog");
    } finally {
      fx.cleanup();
    }
  });

  test("includes tags when present", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.epicsDir, "epic-auth.md"), EPIC_CONTENT);
      const epics = collectEpics(fx.epicsDir);
      const md = generateIndex(epics, fx.backlogPath);
      expect(md).toContain("**Tags:** auth, security");
    } finally {
      fx.cleanup();
    }
  });

  test("omits tags when absent", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.epicsDir, "epic-notags.md"),
        "# EPIC: NoTags\n\n**Status:** 📋 Planned\n**Priority:** Low\n**Effort:** Small\n**Type:** Feature\n",
      );
      const epics = collectEpics(fx.epicsDir);
      const md = generateIndex(epics, fx.backlogPath);
      expect(md).not.toContain("**Tags:**");
    } finally {
      fx.cleanup();
    }
  });

  test("includes overview when present", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.epicsDir, "epic-auth.md"), EPIC_CONTENT);
      const epics = collectEpics(fx.epicsDir);
      const md = generateIndex(epics, fx.backlogPath);
      expect(md).toContain("Implement authentication flow with JWT.");
    } finally {
      fx.cleanup();
    }
  });

  test("handles empty epics list", () => {
    const md = generateIndex([], "/nonexistent");
    expect(md).toContain("**Total:** 0 epics");
    expect(md).toContain("## Epics");
  });
});

// ── genDocs (full round-trip) ──────────────────────────────────

describe("genDocs", () => {
  test("writes epics-index.md to disk", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.epicsDir, "epic-auth.md"), EPIC_CONTENT);
      const { epics, output } = genDocs(fx.epicsDir, fx.outPath, fx.backlogPath);
      expect(epics).toHaveLength(1);
      expect(existsSync(fx.outPath)).toBe(true);
      expect(output).toContain("# Epics Index");
    } finally {
      fx.cleanup();
    }
  });

  test("writes empty index when no epics", () => {
    const fx = makeFixture();
    try {
      const { epics, output } = genDocs(fx.epicsDir, fx.outPath, fx.backlogPath);
      expect(epics).toHaveLength(0);
      expect(existsSync(fx.outPath)).toBe(true);
      expect(output).toContain("**Total:** 0 epics");
    } finally {
      fx.cleanup();
    }
  });
});
