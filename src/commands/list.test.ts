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
