// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt docs sync-agents` — frontmatter shape, idempotent
 * reruns, --dir handling, non-UTF8 skipping and outside-root refusal.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { scratchRoot } from "../../utils/scratch-tmp";
import { docs } from "../docs";
import { agentFileBytes, flattenName } from "./sync-agents";

let root = "";

afterEach(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function makeRoot(slug: string): string {
  root = mkdtempSync(join(scratchRoot(), `giwt-sync-agents-${slug}-`));
  return root;
}

function makeFile(base: string, rel: string, content: string | Uint8Array): string {
  const p = join(base, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

function cfgFor(base: string): WorktreeConfig {
  return {
    repoRoot: base,
    worktreeRoot: base,
    treeDir: base,
    settings: {} as WorktreeConfig["settings"],
  };
}

function captureOut(): { text: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const out = spyOn(process.stdout, "write").mockImplementation((chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  });
  const err = spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    text: () => chunks.join(""),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

function exitSentinel(): { codes: number[]; restore: () => void; } {
  const codes: number[] = [];
  const original = process.exit;
  process.exit = ((code?: number) => {
    codes.push(code ?? 0);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    codes,
    restore: () => {
      process.exit = original;
    },
  };
}

/** Minimal fixture: titled doc, untitled doc (title fallback), nested
 *  doc (name flattening) and a binary doc (skip). */
function seedCorpus(base: string): void {
  makeFile(base, "AGENTS.md", "# Agents\nBe nice.\n");
  makeFile(base, "README.md", "\n");
  makeFile(base, "docs/guide.md", "# Guide\nbody\n");
  makeFile(base, "docs/binary.md", Buffer.from([0xff, 0xfe, 0x00, 0x01]));
}

function agentsDir(): string {
  return join(root, ".agents");
}

describe("docs sync-agents", () => {
  test("writes frontmatter with extracted title and full body", () => {
    seedCorpus(makeRoot("frontmatter"));
    docs(["sync-agents"], cfgFor(root));
    const bytes = readFileSync(join(agentsDir(), "AGENTS.md"), "utf8");
    expect(bytes).toBe(
      "---\nname: AGENTS\ndescription: Agents\nsource: AGENTS\n---\n# Agents\nBe nice.\n",
    );
  });

  test("falls back to the doc name when no title can be extracted", () => {
    seedCorpus(makeRoot("fallback"));
    docs(["sync-agents"], cfgFor(root));
    const bytes = readFileSync(join(agentsDir(), "README.md"), "utf8");
    expect(bytes).toBe(
      agentFileBytes(
        { name: "README", path: "", rel: "" },
        readFileSync(join(root, "README.md"), "utf8"),
      ),
    );
    expect(bytes).toContain("description: README\n");
  });

  test("flattens nested doc names with ->", () => {
    seedCorpus(makeRoot("flatten"));
    expect(flattenName("docs/guide")).toBe("docs->guide");
    docs(["sync-agents"], cfgFor(root));
    expect(existsSync(join(agentsDir(), "docs->guide.md"))).toBe(true);
    expect(existsSync(join(agentsDir(), "docs/guide.md"))).toBe(false);
  });

  test("rerun is idempotent and leaves unknown files (unmanaged)", () => {
    seedCorpus(makeRoot("idempotent"));
    docs(["sync-agents"], cfgFor(root));
    makeFile(agentsDir(), "stray.md", "not managed\n");
    const before = readdirSync(agentsDir()).sort().map((f) => readFileSync(join(agentsDir(), f)));
    const out = captureOut();
    docs(["sync-agents"], cfgFor(root));
    out.restore();
    const after = readdirSync(agentsDir()).sort().map((f) => readFileSync(join(agentsDir(), f)));
    expect(after).toEqual(before);
    expect(existsSync(join(agentsDir(), "stray.md"))).toBe(true);
    expect(out.text()).toContain("unmanaged 1");
  });

  test("skips non-UTF8 docs and reports them", () => {
    seedCorpus(makeRoot("binary"));
    const out = captureOut();
    docs(["sync-agents"], cfgFor(root));
    out.restore();
    expect(existsSync(join(agentsDir(), "docs->binary.md"))).toBe(false);
    expect(out.text()).toContain("skipped 1");
  });

  test("--dir creates a custom directory inside the worktree", () => {
    seedCorpus(makeRoot("customdir"));
    docs(["sync-agents", "--dir", "gen/agents"], cfgFor(root));
    expect(existsSync(join(root, "gen", "agents", "AGENTS.md"))).toBe(true);
  });

  test("refuses --dir resolving outside the worktree root", async () => {
    seedCorpus(makeRoot("escape"));
    const exit = exitSentinel();
    const out = captureOut();
    try {
      await docs(["sync-agents", "--dir", "../outside"], cfgFor(root));
      throw new Error("should have exited");
    } catch (e) {
      expect(String(e)).toContain("__exit:1");
    } finally {
      out.restore();
      exit.restore();
    }
    expect(existsSync(join(root, "..", "outside"))).toBe(false);
    expect(exit.codes).toEqual([1]);
  });

  test("--json emits records", () => {
    seedCorpus(makeRoot("json"));
    const out = captureOut();
    docs(["sync-agents", "--json"], cfgFor(root));
    out.restore();
    const text = out.text();
    expect(text).toContain("AGENTS.md");
    expect(text).toContain("written");
  });
});
