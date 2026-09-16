// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/plan/check-links.ts — markdown stale-link guard.
 *
 * Resource contract (parallel-safe): every test owns a mkdtemp fixture.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkFile,
  checkSrcComments,
  collectLinks,
  collectMdFiles,
  collectSrcFiles,
  collectTaskRefs,
  isAnchorOnly,
  isExternal,
  resolveTarget,
  runLinkCheck,
  stripCodeBlocks,
  stripInlineCode,
} from "./check-links";

interface Fixture {
  root: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-links-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writePath(root: string, rel: string, content: string): void {
  const dir = join(root, ...rel.split("/").slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, rel), content);
}

// ── stripCodeBlocks / stripInlineCode ──────────────────────────

describe("stripCodeBlocks", () => {
  test("strips fenced blocks", () => {
    expect(stripCodeBlocks("a\n```ts\ncode\n```\nb")).toBe("a\n\nb");
  });
  test("handles empty", () => {
    expect(stripCodeBlocks("")).toBe("");
  });
  test("no blocks unchanged", () => {
    expect(stripCodeBlocks("just text")).toBe("just text");
  });
});

describe("stripInlineCode", () => {
  test("strips inline code spans", () => {
    expect(stripInlineCode("see `code` here")).toBe("see  here");
  });
  test("handles empty", () => {
    expect(stripInlineCode("")).toBe("");
  });
});

// ── isExternal / isAnchorOnly ───────────────────────────────────

describe("isExternal", () => {
  test("true for http/https/mailto/ftp", () => {
    expect(isExternal("https://example.com")).toBe(true);
    expect(isExternal("http://foo.bar")).toBe(true);
    expect(isExternal("mailto:dev@x.com")).toBe(true);
    expect(isExternal("ftp://files.x.com")).toBe(true);
  });
  test("false for relative paths", () => {
    expect(isExternal("docs/spec.md")).toBe(false);
    expect(isExternal(".plan/tickets/foo.md")).toBe(false);
  });
});

describe("isAnchorOnly", () => {
  test("true for #fragment", () => {
    expect(isAnchorOnly("#section")).toBe(true);
  });
  test("false for paths", () => {
    expect(isAnchorOnly("docs/spec.md")).toBe(false);
  });
  test("false for #/ paths", () => {
    expect(isAnchorOnly("#/docs/spec.md")).toBe(false);
  });
});

// ── collectLinks ───────────────────────────────────────────────

describe("collectLinks", () => {
  test("collects inline links", () => {
    const text = "See [docs](docs/spec.md) and [more](.plan/tickets/a.md)";
    const links = collectLinks(text);
    expect(links).toHaveLength(2);
    expect(links).toContain("docs/spec.md");
    expect(links).toContain(".plan/tickets/a.md");
  });

  test("collects reference-style links", () => {
    const text = "[ref]: docs/spec.md\n\nSee [text][ref].\n";
    const links = collectLinks(text);
    expect(links).toContain("docs/spec.md");
  });

  test("skips external URLs", () => {
    // collectLinks returns all targets; isExternal filters later
    const text = "See [web](https://example.com)";
    const links = collectLinks(text);
    expect(links).toContain("https://example.com");
  });

  test("handles empty string", () => {
    expect(collectLinks("")).toEqual([]);
  });
});

// ── collectTaskRefs ─────────────────────────────────────────────

describe("collectTaskRefs", () => {
  test("collects bare TASK-xxx refs", () => {
    const text = "See TASK-foo and TASK-bar-baz";
    const refs = collectTaskRefs(text);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.ref).toBe("TASK-foo");
    expect(refs[1]!.ref).toBe("TASK-bar-baz");
  });

  test("skips refs inside markdown link labels", () => {
    const text = "[TASK-foo](url.md) and bare TASK-bar";
    const refs = collectTaskRefs(text);
    // TASK-foo is inside link label [TASK-foo] — skipped
    expect(refs).toHaveLength(1);
    expect(refs[0]!.ref).toBe("TASK-bar");
  });

  test("includes line content", () => {
    const text = "some text\nTASK-foo is here\n";
    const refs = collectTaskRefs(text);
    expect(refs[0]!.line).toContain("TASK-foo is here");
  });

  test("handles empty string", () => {
    expect(collectTaskRefs("")).toEqual([]);
  });
});

// ── resolveTarget ───────────────────────────────────────────────

describe("resolveTarget", () => {
  test("resolves docs/ from project root", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/spec.md", "# Spec");
      const result = resolveTarget(
        "docs/spec.md",
        join(fx.root, "docs/other.md"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toBe(join(fx.root, "docs/spec.md"));
    } finally {
      fx.cleanup();
    }
  });

  test("resolves .plan/ from project root", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, ".plan/tickets/foo.md", "# Foo");
      const result = resolveTarget(
        ".plan/tickets/foo.md",
        join(fx.root, "docs/other.md"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toBe(join(fx.root, ".plan/tickets/foo.md"));
    } finally {
      fx.cleanup();
    }
  });

  test("resolves plan/ as .plan/ shorthand", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, ".plan/tickets/foo.md", "# Foo");
      const result = resolveTarget(
        "plan/tickets/foo.md",
        join(fx.root, "docs/other.md"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toBe(join(fx.root, ".plan/tickets/foo.md"));
    } finally {
      fx.cleanup();
    }
  });

  test("resolves bare TASK-xxx.md from tickets dir", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, ".plan/tickets/TASK-foo.md", "# Foo");
      const result = resolveTarget(
        "TASK-foo.md",
        join(fx.root, ".plan/epics/x.md"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toBe(join(fx.root, ".plan/tickets/TASK-foo.md"));
    } finally {
      fx.cleanup();
    }
  });

  test("returns null for other /-prefixed paths", () => {
    const fx = makeFixture();
    try {
      const result = resolveTarget(
        "/api/users",
        join(fx.root, "docs/x.md"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  test("returns null for anchor-only targets", () => {
    expect(resolveTarget("#section", "/file.md", "/root", ".plan/tickets")).toBeNull();
  });

  test("resolves relative paths against containing file", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/sub/page.md", "# Page");
      const result = resolveTarget(
        "sub/page.md",
        join(fx.root, "docs/index.md"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toBe(join(fx.root, "docs/sub/page.md"));
    } finally {
      fx.cleanup();
    }
  });

  test("strips #fragment before resolution", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/spec.md", "# Spec");
      const result = resolveTarget(
        "docs/spec.md#section",
        join(fx.root, "docs/index.md"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toBe(join(fx.root, "docs/spec.md"));
    } finally {
      fx.cleanup();
    }
  });
});

// ── collectMdFiles / collectSrcFiles ────────────────────────────

describe("collectMdFiles", () => {
  test("collects md files recursively", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/a.md", "# A");
      writePath(fx.root, "docs/sub/b.md", "# B");
      const files = collectMdFiles(fx.root, "docs");
      expect(files).toHaveLength(2);
    } finally {
      fx.cleanup();
    }
  });

  test("handles non-existent dir", () => {
    const fx = makeFixture();
    try {
      expect(collectMdFiles(fx.root, "nonexistent")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("collectSrcFiles", () => {
  test("collects .ts and .tsx files", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "src/a.ts", "export const a = 1;");
      writePath(fx.root, "src/b.tsx", "export const b = 2;");
      writePath(fx.root, "src/c.txt", "not code");
      const files = collectSrcFiles(fx.root, "src");
      expect(files).toHaveLength(2);
    } finally {
      fx.cleanup();
    }
  });

  test("handles non-existent src dir", () => {
    const fx = makeFixture();
    try {
      expect(collectSrcFiles(fx.root, "src")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ── checkFile ───────────────────────────────────────────────────

describe("checkFile", () => {
  test("reports broken markdown links", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/index.md", "# Index\n\n[broken](docs/missing.md)\n");
      const result = checkFile(
        join(fx.root, "docs/index.md"),
        fx.root,
        ".plan/tickets",
        new Set<string>(),
      );
      expect(result.broken).toHaveLength(1);
      expect(result.broken[0]!.target).toBe("docs/missing.md");
    } finally {
      fx.cleanup();
    }
  });

  test("reports no broken links when valid", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/target.md", "# Target");
      writePath(fx.root, "docs/index.md", "[link](docs/target.md)\n");
      const result = checkFile(
        join(fx.root, "docs/index.md"),
        fx.root,
        ".plan/tickets",
        new Set<string>(),
      );
      expect(result.broken).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("reports orphan TASK refs", () => {
    const fx = makeFixture();
    try {
      writePath(
        fx.root,
        ".plan/epics/epic-test.md",
        "# TASK-test: Epic\n\nTASK-nonexistent is here\n",
      );
      const result = checkFile(
        join(fx.root, ".plan/epics/epic-test.md"),
        fx.root,
        ".plan/tickets",
        new Set<string>(["task-other.md"]),
      );
      expect(result.orphanRefs).toHaveLength(1);
      expect(result.orphanRefs[0]!.ref).toBe("TASK-nonexistent");
    } finally {
      fx.cleanup();
    }
  });

  test("resolves TASK refs with prefix matching", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, ".plan/tickets/task-foo-bar.md", "# Foo Bar");
      writePath(fx.root, ".plan/epics/epic.md", "# Epic\n\nTASK-foo is here\n");
      const result = checkFile(
        join(fx.root, ".plan/epics/epic.md"),
        fx.root,
        ".plan/tickets",
        new Set<string>(["task-foo-bar.md"]),
      );
      // TASK-foo should prefix-match task-foo-bar.md
      expect(result.orphanRefs).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("skips self-ref in H1 title", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, ".plan/tickets/TASK-self-ref.md", "# TASK-self-ref\n\nSome content\n");
      const result = checkFile(
        join(fx.root, ".plan/tickets/TASK-self-ref.md"),
        fx.root,
        ".plan/tickets",
        new Set<string>(["task-self-ref.md"]),
      );
      // The file's own H1 contains TASK-self-ref — should be skipped as self-ref
      expect(result.orphanRefs).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("handles non-existent file gracefully", () => {
    const result = checkFile(
      "/nonexistent/file.md",
      "/root",
      ".plan/tickets",
      new Set<string>(),
    );
    expect(result.broken).toEqual([]);
    expect(result.orphanRefs).toEqual([]);
  });
});

// ── checkSrcComments ────────────────────────────────────────────

describe("checkSrcComments", () => {
  test("reports broken doc refs in comments", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "src/a.ts", "// see docs/spec/missing.md\nexport const x = 1;");
      const result = checkSrcComments(
        join(fx.root, "src/a.ts"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe("docs/spec/missing.md");
    } finally {
      fx.cleanup();
    }
  });

  test("reports no broken refs when valid", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/spec/real.md", "# Real");
      writePath(fx.root, "src/a.ts", "// see docs/spec/real.md\nexport const x = 1;");
      const result = checkSrcComments(
        join(fx.root, "src/a.ts"),
        fx.root,
        ".plan/tickets",
      );
      expect(result).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("handles non-existent file gracefully", () => {
    expect(checkSrcComments("/nonexistent.ts", "/root", ".plan/tickets")).toEqual([]);
  });
});

// ── runLinkCheck ────────────────────────────────────────────────

describe("runLinkCheck", () => {
  test("aggregates results across files", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "docs/a.md", "[broken](docs/missing.md)\n");
      writePath(fx.root, "docs/b.md", "[ok](docs/target.md)\n");
      writePath(fx.root, "docs/target.md", "# Target");
      const result = runLinkCheck(fx.root, ["docs"], ".plan/tickets", "src");
      expect(result.fileCount).toBe(3);
      expect(result.broken).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  test("scans source comments", () => {
    const fx = makeFixture();
    try {
      writePath(fx.root, "src/a.ts", "// see docs/spec/missing.md\nexport const x = 1;");
      const result = runLinkCheck(fx.root, ["docs"], ".plan/tickets", "src");
      expect(result.srcFileCount).toBe(1);
      expect(result.brokenComments).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  test("handles empty project", () => {
    const fx = makeFixture();
    try {
      const result = runLinkCheck(fx.root, ["docs"], ".plan/tickets", "src");
      expect(result.fileCount).toBe(0);
      expect(result.srcFileCount).toBe(0);
      expect(result.broken).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });
});
