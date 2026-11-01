// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt backlog` — arg parsing, sync/fix/verbose reporting, and
 * exit codes, including the missing-backlog-dir no-op path.
 *
 * Resource contract (parallel-safe): every test owns a private mkdtempSync
 * root passed via config.worktreeRoot; process.exit and stdout are spied
 * and restored per test. Tier files are optional (tickets+epics carry
 * priority metadata), so a missing backlog dir must exit 0 cleanly.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { scratchRoot } from "../utils/scratch-tmp";
import { backlog } from "./backlog";

let root = "";

afterEach(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function cfgFor(base: string): WorktreeConfig {
  return {
    repoRoot: base,
    worktreeRoot: base,
    treeDir: base,
    settings: {
      paths: { planDir: ".plan" },
    } as WorktreeConfig["settings"],
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

interface RunResult {
  out: string;
  code: number;
}

/** Run the backlog handler with stdout captured; returns output + exit code. */
async function run(args: string[], base: string): Promise<RunResult> {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  // log() routes warn/error to stderr; merge both streams for assertions.
  const out = spyOn(process.stdout, "write").mockImplementation(push as never);
  const err = spyOn(process.stderr, "write").mockImplementation(push as never);
  const exit = exitSentinel();
  try {
    await backlog(args, cfgFor(base));
  } catch (e) {
    expect((e as Error).message).toBe(`__exit:${exit.codes[0]}`);
  } finally {
    exit.restore();
    out.mockRestore();
    err.mockRestore();
  }
  return { out: chunks.join(""), code: exit.codes[0] ?? -1 };
}

/** Consistent backlog fixture: priority.md lists tier.md, which exists. */
function seedConsistent(base: string): string {
  const backlogDir = join(base, ".plan", "backlog");
  mkdirSync(backlogDir, { recursive: true });
  writeFileSync(
    join(backlogDir, "priority.md"),
    "## File map\n\n| [tier](./tier.md) | d |\n",
  );
  writeFileSync(join(backlogDir, "tier.md"), "# Tier\n");
  return backlogDir;
}

describe("backlog arg parsing", () => {
  test("no subcommand → usage + exit 1", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-args-"));
    const r = await run([], root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Usage: giwt backlog <subcommand>");
  });

  test("--help → usage + exit 0", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-args-"));
    const r = await run(["--help"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: giwt backlog <subcommand>");
  });

  test("-h → usage + exit 0", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-args-"));
    const r = await run(["-h"], root);
    expect(r.code).toBe(0);
  });

  test("unknown subcommand → error + usage + exit 1", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-args-"));
    const r = await run(["frobnicate"], root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("unknown backlog subcommand 'frobnicate'");
    expect(r.out).toContain("Usage: giwt backlog <subcommand>");
  });

  test("sync --bogus → sync usage + exit 1", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-args-"));
    const r = await run(["sync", "--bogus"], root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Usage: giwt backlog sync [--fix] [--verbose]");
  });

  test("sync --help → sync usage + exit 0", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-args-"));
    const r = await run(["sync", "--help"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("apply automatic fixes");
  });
});

describe("backlog sync / missing backlog dir", () => {
  test("exits 0 with an informational line and never throws", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-missing-"));
    const r = await run(["sync"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("nothing to sync");
    expect(r.out).toContain("tier files optional");
  });
});

describe("backlog sync / report mode", () => {
  test("consistent dir → exit 0 with OK lines and in-sync outcome", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-ok-"));
    seedConsistent(root);
    const r = await run(["sync"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Reconcile .plan/backlog indexes");
    expect(r.out).toContain("OK: No orphan files");
    expect(r.out).toContain("OK: No phantom entries");
    expect(r.out).toContain("OK: No outside targets");
    expect(r.out).toContain("Backlog indexes are in sync");
  });

  test("issues found → exit 1 with actionable count + fix hint", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-issues-"));
    const backlogDir = seedConsistent(root);
    writeFileSync(join(backlogDir, "stray.md"), "# Stray orphan\n");
    const r = await run(["sync"], root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Orphans (not in any index file map): 1");
    expect(r.out).toContain("actionable issue(s) found");
    expect(r.out).toContain("Run with --fix to apply automatic fixes");
  });

  test("phantoms and outside targets are reported with warn lines", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-warns-"));
    const backlogDir = join(root, ".plan", "backlog");
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(
      join(backlogDir, "priority.md"),
      "## File map\n\n| [ghost](./ghost.md) | d |\n| [outside](../outside.md) | d |\n",
    );
    const r = await run(["sync"], root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Phantoms (index maps missing file): 1");
    expect(r.out).toContain("Non-backlog file-map targets: 1");
  });

  test("--verbose shows per-file map state", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-verbose-"));
    seedConsistent(root);
    const r = await run(["sync", "--verbose"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("File map state");
    expect(r.out).toContain("Listed: 1 - Unlisted (orphans): 0");
  });

  test("--verbose marks multiple homes as warn", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-dup-"));
    const backlogDir = join(root, ".plan", "backlog");
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(
      join(backlogDir, "priority.md"),
      "## File map\n\n| [tier](./tier.md) | d |\n",
    );
    writeFileSync(
      join(backlogDir, "open.md"),
      "## File map\n\n| [tier](./tier.md) | d |\n",
    );
    writeFileSync(join(backlogDir, "tier.md"), "# Tier\n");
    const r = await run(["sync", "--verbose"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("[warn] multiple homes");
  });
});

describe("backlog sync / --fix", () => {
  test("orphan is added to the priority file map + exit 0", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-fix-"));
    const backlogDir = seedConsistent(root);
    writeFileSync(join(backlogDir, "task.md"), "# Task orphan\n");
    const r = await run(["sync", "--fix"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("task.md: added to priority.md file map");
    expect(r.out).toContain("Wrote index file(s). Re-run without --fix to verify.");
    const committed = readFileSync(join(backlogDir, "priority.md"), "utf8");
    expect(committed).toContain("task.md");
  });

  test("open- prefixed orphan lands in open.md", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-fix-open-"));
    const backlogDir = seedConsistent(root);
    writeFileSync(
      join(backlogDir, "open.md"),
      "## File map\n\n| File | Desc |\n| --- | --- |\n| [tier](./tier.md) | d |\n",
    );
    writeFileSync(join(backlogDir, "open-note.md"), "# Open orphan\n");
    const r = await run(["sync", "--fix"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("open-note.md: added to open.md file map");
  });

  test("phantom row is dropped + exit 0", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-fix-phantom-"));
    const backlogDir = seedConsistent(root);
    writeFileSync(
      join(backlogDir, "priority.md"),
      "## File map\n\n| [tier](./tier.md) | d |\n| [ghost](./ghost.md) | d |\n",
    );
    const r = await run(["sync", "--fix"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("dropped phantom row (ghost.md)");
    expect(r.out).toContain("Wrote index file(s). Re-run without --fix to verify.");
    const committed = readFileSync(join(backlogDir, "priority.md"), "utf8");
    expect(committed).not.toContain("ghost.md");
  });

  test("outside target stays and is flagged for manual review", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-fix-outside-"));
    const backlogDir = seedConsistent(root);
    writeFileSync(join(backlogDir, "task.md"), "# Task orphan\n");
    writeFileSync(
      join(backlogDir, "priority.md"),
      "## File map\n\n| [tier](./tier.md) | d |\n| [outside](../outside.md) | d |\n",
    );
    const r = await run(["sync", "--fix"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("outside target ../outside.md - manual review");
    expect(r.out).toContain("residual issue(s) after fix");
  });

  test("consistent dir → 'Nothing to fix' + exit 0", async () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-backlog-fix-none-"));
    seedConsistent(root);
    const r = await run(["sync", "--fix"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing to fix");
  });
});
