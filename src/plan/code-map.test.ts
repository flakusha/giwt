// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/plan/code-map.ts — reverse code→plan index.
 *
 * Resource contract (parallel-safe): every test owns a mkdtemp fixture
 * with its own project root and .plan/ structure.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMap,
  type CodeMap,
  collectMdFiles,
  findOwners,
  findStale,
  readMap,
  verifyFresh,
  writeMap,
} from "./code-map";

interface Fixture {
  root: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-codemap-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writePlan(root: string, dir: string, file: string, content: string): void {
  const dirPath = join(root, dir);
  mkdirSync(dirPath, { recursive: true });
  writeFileSync(join(dirPath, file), content);
}

// ── collectMdFiles ──────────────────────────────────────────────

describe("collectMdFiles", () => {
  test("collects all .md files in a directory", () => {
    const fx = makeFixture();
    try {
      writePlan(fx.root, ".plan/tickets", "TASK-foo.md", "# Foo");
      writePlan(fx.root, ".plan/tickets", "BUG-bar.md", "# Bar");
      writePlan(fx.root, ".plan/tickets", "not-md.txt", "text");
      const files = collectMdFiles(fx.root, ".plan/tickets");
      expect(files).toHaveLength(2);
      expect(files.some((f) => f.endsWith("TASK-foo.md"))).toBe(true);
      expect(files.some((f) => f.endsWith("BUG-bar.md"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("handles non-existent directory", () => {
    const fx = makeFixture();
    try {
      expect(collectMdFiles(fx.root, "nonexistent")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("skips node_modules and .git", () => {
    const fx = makeFixture();
    try {
      writePlan(fx.root, "docs", "real.md", "# Real");
      writePlan(fx.root, "node_modules", "fake.md", "# Fake");
      const files = collectMdFiles(fx.root, "docs");
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("real.md");
    } finally {
      fx.cleanup();
    }
  });

  test("walks subdirectories recursively", () => {
    const fx = makeFixture();
    try {
      writePlan(fx.root, "docs/spec", "a.md", "# A");
      writePlan(fx.root, "docs/spec/sub", "b.md", "# B");
      const files = collectMdFiles(fx.root, "docs");
      expect(files).toHaveLength(2);
    } finally {
      fx.cleanup();
    }
  });
});

// ── buildMap ────────────────────────────────────────────────────

describe("buildMap", () => {
  test("builds reverse index from plan markdown", () => {
    const fx = makeFixture();
    try {
      writePlan(
        fx.root,
        ".plan/tickets",
        "TASK-foo.md",
        "# TASK: Foo\n\nTouches `src/utils/config.ts` and src/commands/plan.ts",
      );
      const map = buildMap(fx.root, [{ dir: ".plan/tickets", kind: "ticket" }]);
      expect(Object.keys(map)).toHaveLength(2);
      expect(map["src/utils/config.ts"]).toBeDefined();
      expect(map["src/utils/config.ts"]![0]!.kind).toBe("ticket");
    } finally {
      fx.cleanup();
    }
  });

  test("sorts entries by source path", () => {
    const fx = makeFixture();
    try {
      writePlan(
        fx.root,
        ".plan/tickets",
        "a-ticket.md",
        "see src/shared.ts",
      );
      writePlan(
        fx.root,
        ".plan/epics",
        "z-epic.md",
        "see src/shared.ts",
      );
      const map = buildMap(fx.root, [
        { dir: ".plan/tickets", kind: "ticket" },
        { dir: ".plan/epics", kind: "epic" },
      ]);
      const entries = map["src/shared.ts"]!;
      expect(entries).toHaveLength(2);
      // Sorted by source path: .plan/epics/z-epic.md < .plan/tickets/a-ticket.md
      expect(entries[0]!.source).toBe(".plan/epics/z-epic.md");
      expect(entries[1]!.source).toBe(".plan/tickets/a-ticket.md");
    } finally {
      fx.cleanup();
    }
  });

  test("handles non-existent source dirs", () => {
    const fx = makeFixture();
    try {
      const map = buildMap(fx.root, [
        { dir: ".plan/tickets", kind: "ticket" },
        { dir: "docs/spec", kind: "spec" },
      ]);
      expect(Object.keys(map)).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("deduplicates refs from same file", () => {
    const fx = makeFixture();
    try {
      writePlan(
        fx.root,
        ".plan/tickets",
        "TASK-foo.md",
        "see src/foo.ts and src/foo.ts again",
      );
      const map = buildMap(fx.root, [{ dir: ".plan/tickets", kind: "ticket" }]);
      expect(map["src/foo.ts"]).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ── readMap / writeMap ──────────────────────────────────────────

describe("readMap / writeMap", () => {
  test("writeMap writes valid JSON", () => {
    const fx = makeFixture();
    try {
      const mapPath = join(fx.root, "code-map.json");
      const map: CodeMap = {
        "src/foo.ts": [{ kind: "ticket", source: ".plan/tickets/a.md" }],
      };
      writeMap(mapPath, map);
      expect(existsSync(mapPath)).toBe(true);
      const read = readMap(mapPath);
      expect(read).toEqual(map);
    } finally {
      fx.cleanup();
    }
  });

  test("readMap returns empty for missing file", () => {
    expect(readMap("/nonexistent/map.json")).toEqual({});
  });

  test("readMap returns empty for corrupt JSON", () => {
    const fx = makeFixture();
    try {
      const mapPath = join(fx.root, "code-map.json");
      writeFileSync(mapPath, "not json {{{");
      expect(readMap(mapPath)).toEqual({});
    } finally {
      fx.cleanup();
    }
  });
});

// ── verifyFresh ─────────────────────────────────────────────────

describe("verifyFresh", () => {
  test("returns true when committed matches fresh", () => {
    const fx = makeFixture();
    try {
      const mapPath = join(fx.root, "code-map.json");
      const map: CodeMap = {
        "src/foo.ts": [{ kind: "ticket", source: ".plan/tickets/a.md" }],
      };
      writeMap(mapPath, map);
      expect(verifyFresh(mapPath, map)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("returns false when committed differs from fresh", () => {
    const fx = makeFixture();
    try {
      const mapPath = join(fx.root, "code-map.json");
      const committed: CodeMap = {
        "src/foo.ts": [{ kind: "ticket", source: ".plan/tickets/a.md" }],
      };
      writeMap(mapPath, committed);
      const fresh: CodeMap = {
        "src/bar.ts": [{ kind: "ticket", source: ".plan/tickets/b.md" }],
      };
      expect(verifyFresh(mapPath, fresh)).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("returns false when map file missing", () => {
    expect(verifyFresh("/nonexistent/map.json", {})).toBe(false);
  });
});

// ── findOwners ──────────────────────────────────────────────────

describe("findOwners", () => {
  const testMap: CodeMap = {
    "src/foo.ts": [
      { kind: "ticket", source: ".plan/tickets/a.md" },
      { kind: "epic", source: ".plan/epics/b.md" },
    ],
    "src/foo/bar.ts": [{ kind: "ticket", source: ".plan/tickets/c.md" }],
    "src/foo/baz.ts": [{ kind: "spec", source: "docs/spec/d.md" }],
  };

  test("finds exact match", () => {
    const { exact, prefix } = findOwners(testMap, "src/foo.ts");
    expect(exact).toHaveLength(2);
    // No keys start with "src/foo.ts/" (bar/baz are under "src/foo/")
    expect(prefix).toHaveLength(0);
  });

  test("finds prefix matches for directory", () => {
    const { exact, prefix } = findOwners(testMap, "src/foo");
    expect(exact).toHaveLength(0);
    expect(prefix).toHaveLength(2);
  });

  test("normalizes leading ./ and /", () => {
    const { exact } = findOwners(testMap, "./src/foo.ts");
    expect(exact).toHaveLength(2);
  });

  test("returns empty for no match", () => {
    const { exact, prefix } = findOwners(testMap, "src/nonexistent.ts");
    expect(exact).toHaveLength(0);
    expect(prefix).toHaveLength(0);
  });

  test("limits prefix results to 20", () => {
    const bigMap: CodeMap = {};
    for (let i = 0; i < 30; i++) {
      bigMap[`src/foo/file${i}.ts`] = [{ kind: "ticket", source: `a${i}.md` }];
    }
    const { prefix } = findOwners(bigMap, "src/foo");
    expect(prefix).toHaveLength(20);
  });
});

// ── findStale ───────────────────────────────────────────────────

describe("findStale", () => {
  test("reports paths that don't exist on disk", () => {
    const fx = makeFixture();
    try {
      // Create one file that exists
      writePlan(fx.root, "src", "real.ts", "export const x = 1;");
      const map: CodeMap = {
        "src/real.ts": [{ kind: "ticket", source: "a.md" }],
        "src/ghost.ts": [{ kind: "ticket", source: "b.md" }],
      };
      const stale = findStale(fx.root, map);
      expect(stale).toHaveLength(1);
      expect(stale[0]).toContain("src/ghost.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("returns empty when all paths exist", () => {
    const fx = makeFixture();
    try {
      writePlan(fx.root, "src", "real.ts", "export const x = 1;");
      const map: CodeMap = {
        "src/real.ts": [{ kind: "ticket", source: "a.md" }],
      };
      expect(findStale(fx.root, map)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("returns empty for empty map", () => {
    expect(findStale("/nonexistent", {})).toEqual([]);
  });
});
