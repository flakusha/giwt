// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Root-resolution tests across the worktree layouts the harness supports:
 * in-repo `tree/<branch>`, sibling `<project>-worktrees/`, and the
 * `~/.omp/agent/wt/` and `~/.omp/profiles/<profile>/` shapes (created under
 * a temp root — never the real home). Each layout must resolve
 * getWorktreeRoot() to the linked worktree and findRepoRoot() to the main
 * repo, so run records and plan-file sync stay in the checkout actually
 * running while the shared ledger/issue store stays with the main repo.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { findRepoRoot, getWorktreeRoot } from "./git";

/** Hermetic env for fixture git calls: concurrent test files may mutate
 *  process.env (e.g. GNUPGHOME); spawned git must not inherit that. */
function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_") || key === "GNUPGHOME") continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
}

function initRepoWithCommit(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.email", "test@example.com");
  git(path, "config", "user.name", "test");
  git(path, "config", "commit.gpgsign", "false");
  writeFileSync(join(path, "f.txt"), "x\n");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "init");
}

/** Worktree layouts oh-my-pi creates; paths relative to the temp fixture root. */
const LAYOUTS: Array<[string, string]> = [
  ["tree/ (in-repo)", "proj/tree/wt"],
  ["sibling <project>-worktrees/", "proj-worktrees/wt"],
  ["~/.omp/agent/wt/", ".omp/agent/wt/x"],
  ["~/.omp/profiles/<profile>/", ".omp/profiles/p/wt/x"],
];

describe("worktree root resolution", () => {
  for (const [label, rel] of LAYOUTS) {
    it(`resolves both roots in a ${label} worktree`, () => {
      const base = mkdtempSync(join(tmpdir(), "giwt-wtroot-"));
      const repo = join(base, "proj");
      const wt = join(base, rel);
      try {
        initRepoWithCommit(repo);
        git(repo, "worktree", "add", "-q", "-b", "wt-branch", wt);

        expect(realpathSync(getWorktreeRoot(wt))).toBe(realpathSync(wt));
        expect(realpathSync(findRepoRoot(wt))).toBe(realpathSync(repo));
        // Anti-leakage: the main-root resolution must not collapse onto the
        // worktree itself, even when the worktree sits inside the repo.
        expect(findRepoRoot(wt)).not.toBe(getWorktreeRoot(wt));
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });
  }

  it("loadConfig splits worktreeRoot from repoRoot inside a worktree", async () => {
    const base = mkdtempSync(join(tmpdir(), "giwt-loadcfg-"));
    const repo = join(base, "proj");
    const wt = join(repo, "tree", "wt");
    const prevCwd = process.cwd();
    try {
      initRepoWithCommit(repo);
      git(repo, "worktree", "add", "-q", "-b", "wt-branch", wt);
      process.chdir(wt);

      const config = await loadConfig();
      expect(realpathSync(config.worktreeRoot)).toBe(realpathSync(wt));
      expect(realpathSync(config.repoRoot)).toBe(realpathSync(repo));
      // Shared state stays with the main checkout.
      expect(config.treeDir.startsWith(config.repoRoot)).toBe(true);
    } finally {
      process.chdir(prevCwd);
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("loadConfig keeps both roots identical at the main repo", async () => {
    const base = mkdtempSync(join(tmpdir(), "giwt-loadcfg-main-"));
    const prevCwd = process.cwd();
    try {
      initRepoWithCommit(join(base, "proj"));
      process.chdir(join(base, "proj"));

      const config = await loadConfig();
      expect(config.worktreeRoot).toBe(config.repoRoot);
    } finally {
      process.chdir(prevCwd);
      rmSync(base, { recursive: true, force: true });
    }
  });
});
