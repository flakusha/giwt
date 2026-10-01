// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the list command's ahead/behind sync labels. Stale-registry
 * rendering and the empty-registry baseline live in worktree-registry.test.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { setLogLevel, setOutputFormat } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { listWorktrees } from "./list";

let root: string;
let treeDir: string;
let config: WorktreeConfig;

/** Run git in the fixture repo (or a given dir); throw on failure. */
function git(args: string[], cwd: string = root): string {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: env as Record<string, string>,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function captureOutput(): { lines: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    lines: () => chunks.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

function addWorktree(branch: string): string {
  const wtPath = resolve(treeDir, branchToPath(branch));
  git(["worktree", "add", "-q", "-b", branch, wtPath, "main"]);
  return wtPath;
}

function commitAll(message: string, cwd: string = root): void {
  writeFileSync(join(cwd, `f-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`), "x\n");
  git(["add", "."], cwd);
  git(["commit", "-qm", message], cwd);
}

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  root = mkdtempSync(join(tmpdir(), "giwt-list-test-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-qm", "seed"]);
  treeDir = resolve(root, "tree");
  config = { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("list: sync labels", () => {
  test("worktree ahead of the root branch", async () => {
    const wtPath = addWorktree("ahead-only");
    commitAll("ahead commit", wtPath);
    const cap = captureOutput();
    try {
      await listWorktrees([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("Worktrees");
    expect(out).toContain("ahead 1");
    expect(out).not.toContain("behind 1");
  });

  test("worktree behind the root branch", async () => {
    const wtPath = addWorktree("behind-only");
    commitAll("root moves on");
    const cap = captureOutput();
    try {
      await listWorktrees([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("behind 1");
    expect(existsSync(wtPath)).toBe(true);
  });

  test("worktree both ahead and behind", async () => {
    const wtPath = addWorktree("diverged");
    commitAll("root moves on");
    commitAll("wt moves on too", wtPath);
    const cap = captureOutput();
    try {
      await listWorktrees([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("ahead 1");
    expect(out).toContain("behind 1");
  });
});

describe("list: machine output flags", () => {
  test("--json parses to one record per worktree", async () => {
    addWorktree("feat-json");
    const cap = captureOutput();
    try {
      await listWorktrees(["--json"], config);
    } finally {
      cap.restore();
    }
    const records = JSON.parse(cap.lines()) as Array<{
      branch: string;
      path: string;
      head: string;
      ahead?: number;
      behind?: number;
    }>;
    expect(records).toHaveLength(2); // main + the new worktree
    const rec = records.find((r) => r.branch === "feat-json");
    expect(rec?.path).toBe(resolve(treeDir, branchToPath("feat-json")));
    expect(rec?.head).toMatch(/^[0-9a-f]{8}$/);
  });

  test("--toml round-trips via Bun.TOML.parse", async () => {
    addWorktree("feat-toml");
    const cap = captureOutput();
    try {
      await listWorktrees(["--toml"], config);
    } finally {
      cap.restore();
    }
    const parsed = Bun.TOML.parse(cap.lines()) as {
      items: Array<{ branch: string; }>;
    };
    expect(parsed.items.some((r) => r.branch === "feat-toml")).toBe(true);
  });

  test("--emoji prints one line per worktree", async () => {
    addWorktree("feat-emoji");
    const cap = captureOutput();
    try {
      await listWorktrees(["--emoji"], config);
    } finally {
      cap.restore();
    }
    const lines = cap.lines().trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith("📁"))).toBe(true);
    expect(cap.lines()).toContain("feat-emoji");
  });
});

describe("list: stale records and flag conflicts", () => {
  test("--json marks a worktree whose directory vanished as stale", async () => {
    const wtPath = addWorktree("ghost-json");
    rmSync(wtPath, { recursive: true, force: true });
    const cap = captureOutput();
    try {
      await listWorktrees(["--json"], config);
    } finally {
      cap.restore();
    }
    const records = JSON.parse(cap.lines()) as Array<{
      branch: string;
      stale?: string;
      ahead?: number;
      behind?: number;
    }>;
    const rec = records.find((r) => r.branch === "ghost-json");
    expect(rec?.stale).toBe("directory missing");
    // Sync state is omitted rather than fabricated when stale.
    expect(rec?.ahead).toBeUndefined();
    expect(rec?.behind).toBeUndefined();
  });

  test("multiple output flags warn and keep the first", async () => {
    addWorktree("feat-multi");
    const cap = captureOutput();
    try {
      await listWorktrees(["--json", "--toml"], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("multiple output flags");
    // --json wins: the raw payload carries the JSON record.
    expect(cap.lines()).toContain("feat-multi");
  });

  test("missing root branch ref falls back to bare HEAD line", async () => {
    const wtPath = addWorktree("orphan-status");
    commitAll("orphan commit", wtPath);
    git(["update-ref", "-d", "refs/heads/main"]);
    const cap = captureOutput();
    try {
      await listWorktrees([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    // Main registry entry is stale (its ref is gone)…
    expect(out).toContain("branch ref missing");
    // …while the surviving worktree can't compute sync state and prints
    // a bare HEAD instead of a fabricated ahead/behind label.
    expect(out).not.toContain("up to date");
    expect(out).not.toContain("ahead");
    expect(out).toMatch(/HEAD: [0-9a-f]{8}/);
  });
});
