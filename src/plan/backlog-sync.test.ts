// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/plan/backlog-sync.ts — reconcile .plan/backlog/ index
 * file maps ↔ tier files.
 *
 * Resource contract (parallel-safe): every test owns a mkdtemp fixture
 * holding its own backlog dir; nothing shared.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes, parseFileMap, reconcile } from "./backlog-sync";

interface Fixture {
  backlogDir: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-backlog-"));
  const backlogDir = join(root, "backlog");
  mkdirSync(backlogDir, { recursive: true });
  return {
    backlogDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeFile(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

const INDEX_FILE_MAP = (files: string[]): string =>
  `## File map\n\n| File | Description |\n| ---- | ----------- |\n`
  + files.map((f) => `| [${f.replace(/\.md$/, "")}](./${f}) | desc |`).join("\n")
  + "\n";

// ── parseFileMap ────────────────────────────────────────────────

describe("parseFileMap", () => {
  test("parses file map rows", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["priority-p0-p2.md"]));
      const rows = parseFileMap(join(fx.backlogDir, "priority.md"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.file).toBe("priority-p0-p2.md");
      expect(rows[0]!.target).toBe("./priority-p0-p2.md");
    } finally {
      fx.cleanup();
    }
  });

  test("returns empty for non-existent file", () => {
    expect(parseFileMap("/nonexistent/path.md")).toEqual([]);
  });

  test("returns empty when no file map section", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "test.md", "# Title\n\nNo file map here\n");
      const rows = parseFileMap(join(fx.backlogDir, "test.md"));
      expect(rows).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("stops at next section after file map", () => {
    const fx = makeFixture();
    try {
      const content =
        `## File map\n\n| [a](./a.md) | d |\n\n## Next Section\n\n| [b](./b.md) | d |\n`;
      writeFile(fx.backlogDir, "test.md", content);
      const rows = parseFileMap(join(fx.backlogDir, "test.md"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.file).toBe("a.md");
    } finally {
      fx.cleanup();
    }
  });

  test("skips separator rows", () => {
    const fx = makeFixture();
    try {
      writeFile(
        fx.backlogDir,
        "test.md",
        `## File map\n\n| File | Desc |\n| --- | --- |\n| [a](./a.md) | d |\n`,
      );
      const rows = parseFileMap(join(fx.backlogDir, "test.md"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.file).toBe("a.md");
    } finally {
      fx.cleanup();
    }
  });
});

// ── reconcile ───────────────────────────────────────────────────

describe("reconcile", () => {
  test("reports no issues when in sync", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["priority-p0-p2.md"]));
      writeFile(fx.backlogDir, "priority-p0-p2.md", "# P0-P2\n");
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      expect(result.orphans).toEqual([]);
      expect(result.phantoms).toEqual([]);
      expect(result.outside).toEqual([]);
      expect(result.issueCount).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("reports orphan tier files not in any index", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["priority-p0-p2.md"]));
      writeFile(fx.backlogDir, "priority-p0-p2.md", "# P0-P2\n");
      writeFile(fx.backlogDir, "priority-p3-p5.md", "# P3-P5\n"); // orphan
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      expect(result.orphans).toEqual(["priority-p3-p5.md"]);
      expect(result.issueCount).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("reports phantom entries for missing files", () => {
    const fx = makeFixture();
    try {
      writeFile(
        fx.backlogDir,
        "priority.md",
        INDEX_FILE_MAP(["priority-p0-p2.md", "nonexistent.md"]),
      );
      writeFile(fx.backlogDir, "priority-p0-p2.md", "# P0-P2\n");
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      expect(result.phantoms).toHaveLength(1);
      expect(result.phantoms[0]!.row.file).toBe("nonexistent.md");
      expect(result.issueCount).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("reports outside targets (paths with /)", () => {
    const fx = makeFixture();
    try {
      writeFile(
        fx.backlogDir,
        "priority.md",
        `## File map\n\n| [x](../outside.md) | d |\n`,
      );
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      expect(result.outside).toHaveLength(1);
      expect(result.outside[0]!.row.file).toBe("../outside.md");
    } finally {
      fx.cleanup();
    }
  });

  test("skips non-existent index files", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["a.md"]));
      writeFile(fx.backlogDir, "a.md", "# A\n");
      // open.md doesn't exist — should be skipped
      const result = reconcile(fx.backlogDir, ["priority.md", "open.md"]);
      expect(result.issueCount).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("multiple index files combine", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["priority-p0-p2.md"]));
      writeFile(fx.backlogDir, "open.md", INDEX_FILE_MAP(["open-inflight.md"]));
      writeFile(fx.backlogDir, "priority-p0-p2.md", "# P0-P2\n");
      writeFile(fx.backlogDir, "open-inflight.md", "# Inflight\n");
      const result = reconcile(fx.backlogDir, ["priority.md", "open.md"]);
      expect(result.issueCount).toBe(0);
      expect(result.map.size).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test("index files themselves are not considered orphans", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["a.md"]));
      writeFile(fx.backlogDir, "a.md", "# A\n");
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      expect(result.orphans).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("detects multiple homes (file in multiple indexes)", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["shared.md"]));
      writeFile(fx.backlogDir, "open.md", INDEX_FILE_MAP(["shared.md"]));
      writeFile(fx.backlogDir, "shared.md", "# Shared\n");
      const result = reconcile(fx.backlogDir, ["priority.md", "open.md"]);
      expect(result.issueCount).toBe(0);
      const homes = result.map.get("shared.md");
      expect(homes).toHaveLength(2);
    } finally {
      fx.cleanup();
    }
  });

  test("empty backlog dir", () => {
    const fx = makeFixture();
    try {
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      expect(result.orphans).toEqual([]);
      expect(result.phantoms).toEqual([]);
      expect(result.issueCount).toBe(0);
    } finally {
      fx.cleanup();
    }
  });
});

// ── applyFixes ──────────────────────────────────────────────────

describe("applyFixes", () => {
  test("adds orphan files to correct index", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["priority-p0-p2.md"]));
      writeFile(fx.backlogDir, "priority-p0-p2.md", "# P0-P2\n");
      writeFile(fx.backlogDir, "priority-p3-p5.md", "# P3-P5\n"); // orphan
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      const fixReport = applyFixes(fx.backlogDir, result);
      expect(fixReport.changed).toBe(true);
      expect(fixReport.added).toHaveLength(1);
      // Verify the row was actually added
      const reReconcile = reconcile(fx.backlogDir, ["priority.md"]);
      expect(reReconcile.orphans).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("adds open-* orphans to open.md", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP([]));
      writeFile(fx.backlogDir, "open.md", INDEX_FILE_MAP([]));
      writeFile(fx.backlogDir, "open-debt.md", "# Debt\n"); // orphan
      const result = reconcile(fx.backlogDir, ["priority.md", "open.md"]);
      const fixReport = applyFixes(fx.backlogDir, result);
      expect(fixReport.added[0]).toContain("open.md");
    } finally {
      fx.cleanup();
    }
  });

  test("drops phantom rows", () => {
    const fx = makeFixture();
    try {
      writeFile(
        fx.backlogDir,
        "priority.md",
        INDEX_FILE_MAP(["priority-p0-p2.md", "ghost.md"]),
      );
      writeFile(fx.backlogDir, "priority-p0-p2.md", "# P0-P2\n");
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      const fixReport = applyFixes(fx.backlogDir, result);
      expect(fixReport.changed).toBe(true);
      expect(fixReport.dropped).toHaveLength(1);
      expect(fixReport.dropped[0]).toContain("ghost.md");
    } finally {
      fx.cleanup();
    }
  });

  test("reports outside targets for manual review", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", `## File map\n\n| [x](../outside.md) | d |\n`);
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      const fixReport = applyFixes(fx.backlogDir, result);
      expect(fixReport.outside).toHaveLength(1);
      expect(fixReport.outside[0]).toContain("manual review");
      // Outside targets don't count as changed
      expect(fixReport.changed).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("nothing to fix returns changed=false", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", INDEX_FILE_MAP(["a.md"]));
      writeFile(fx.backlogDir, "a.md", "# A\n");
      const result = reconcile(fx.backlogDir, ["priority.md"]);
      const fixReport = applyFixes(fx.backlogDir, result);
      expect(fixReport.changed).toBe(false);
      expect(fixReport.added).toEqual([]);
      expect(fixReport.dropped).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("addMapRow returns false when no file map section", () => {
    const fx = makeFixture();
    try {
      writeFile(fx.backlogDir, "priority.md", "# No file map\n");
      writeFile(fx.backlogDir, "orphan.md", "# Orphan\n");
      const orphanResult = reconcile(fx.backlogDir, ["priority.md"]);
      const fixReport = applyFixes(fx.backlogDir, orphanResult);
      // addMapRow returns false → not added
      expect(fixReport.added).toEqual([]);
      expect(fixReport.changed).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});
