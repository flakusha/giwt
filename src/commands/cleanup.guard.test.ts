// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Cleanup of stale worktrees under the git backend: the tree/ directory is
 * scanned, worktrees whose branch was deleted are removed, and empty
 * directories are pruned. Fixtures are real scratch repos (mkdtemp under the
 * giwt scratch root, removed in finally) driven by the real git binary —
 * the cleanup path is git-only by construction.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute } from "./cleanup";

let outChunks: string[] = [];
let outSpy: { mockRestore: () => void; } | null = null;

afterEach(() => {
  outSpy?.mockRestore();
  outSpy = null;
  outChunks = [];
  process.exitCode = 0;
});

function captureStdout(): void {
  outChunks = [];
  outSpy = spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown) => {
      outChunks.push(String(chunk));
      return true;
    }) as never,
  );
}

function git(root: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().trim();
}

/** A git repo with one empty commit, a tree/ dir and a `feature` branch. */
function makeRepo(prefix: string): { root: string; treeDir: string; config: WorktreeConfig; } {
  const root = mkdtempSync(join(scratchRoot(), prefix));
  git(root, ["init", "-q", "-b", "master", "."]);
  git(root, ["config", "user.email", "giwt-test@localhost"]);
  git(root, ["config", "user.name", "giwt test"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "init"]);
  git(root, ["branch", "feature"]);
  const treeDir = join(root, "tree");
  mkdirSync(treeDir);
  const config: WorktreeConfig = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir,
    settings: DEFAULT_SETTINGS,
  };
  return { root, treeDir, config };
}

describe("cleanup under the git backend", () => {
  test("a non-git backend refuses before touching the tree", async () => {
    const { root, config } = makeRepo("giwt-cleanup-guard-");
    try {
      const guarded: WorktreeConfig = {
        ...config,
        settings: { ...DEFAULT_SETTINGS, vcs: { backend: "jj" } },
      };
      let message = "";
      try {
        await execute([], guarded);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("giwt cleanup");
      expect(message).toContain("[vcs] backend = \"jj\"");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing tree/ directory is a no-op", async () => {
    const { root, config } = makeRepo("giwt-cleanup-missing-");
    rmSync(config.treeDir, { recursive: true, force: true });
    try {
      captureStdout();
      await execute([], config);
      expect(outChunks.join("")).toContain("no tree/ directory");
      expect(outChunks.join("")).toContain("nothing to clean");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a worktree whose branch still exists is kept", async () => {
    const { root, treeDir, config } = makeRepo("giwt-cleanup-kept-");
    try {
      git(root, ["worktree", "add", join(treeDir, "wt"), "feature"]);
      captureStdout();
      await execute([], config);
      const out = outChunks.join("");
      expect(out).toContain("Kept:");
      expect(out).toContain("branch 'feature' exists");
      expect(existsSync(join(treeDir, "wt"))).toBe(true);
      expect(out).toContain("Cleanup complete: 0 worktree(s) removed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a worktree whose branch was deleted is removed and counted", async () => {
    const { root, treeDir, config } = makeRepo("giwt-cleanup-stale-");
    try {
      git(root, ["worktree", "add", join(treeDir, "wt"), "feature"]);
      git(root, ["update-ref", "-d", "refs/heads/feature"]);
      captureStdout();
      await execute([], config);
      const out = outChunks.join("");
      expect(out).toContain("Removing stale:");
      expect(out).toContain("branch 'feature' deleted");
      expect(out).toContain("Cleanup complete: 1 worktree(s) removed");
      expect(existsSync(join(treeDir, "wt"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unreadable directory is skipped instead of aborting the cleanup", async () => {
    const { root, treeDir, config } = makeRepo("giwt-cleanup-unreadable-");
    try {
      const locked = join(treeDir, "locked");
      mkdirSync(locked);
      writeFileSync(join(locked, "keep.txt"), "x");
      chmodSync(locked, 0o000);
      captureStdout();
      try {
        await execute([], config);
      } finally {
        chmodSync(locked, 0o700);
      }
      const out = outChunks.join("");
      expect(out).toContain("Cleanup complete: 0 worktree(s) removed");
      expect(existsSync(locked)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a detached-HEAD worktree is skipped and an empty directory is pruned", async () => {
    const { root, treeDir, config } = makeRepo("giwt-cleanup-detached-");
    try {
      git(root, ["worktree", "add", "--detach", join(treeDir, "wt")]);
      const orphan = join(treeDir, "orphan");
      mkdirSync(orphan);
      captureStdout();
      await execute([], config);
      const out = outChunks.join("");
      expect(out).toContain("Skipped (detached HEAD):");
      expect(existsSync(orphan)).toBe(false);
      expect(existsSync(join(treeDir, "wt"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
