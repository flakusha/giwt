// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ephemeral staging worktree plumbing for the finalize merge
 * (FEAT-merge-in-staging-worktree-with-ref-move): directory naming,
 * registration, pruning of orphans, and detached checkouts.
 *
 * A SIGKILL mid-merge leaves a staging directory plus an unmoved target ref;
 * `giwt abort` prunes the orphan, and every finalize attempt prunes stale
 * staging dirs for its branch before starting. Nothing user-authored is ever
 * stashed or reset.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { branchToPath, type WorktreeConfig } from "../../utils/config";
import { isolatedGitEnv } from "../../utils/git";
import { log, raw } from "../../utils/output";

export function spawnGit(
  args: string[],
  cwd: string,
): { exitCode: number; stdout: string; stderr: string; } {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** Directory name for this finalize attempt's staging worktree. */
export function stagingDirFor(config: WorktreeConfig, branch: string): string {
  return join(config.treeDir, `.finalize-${branchToPath(branch)}-${process.pid}`);
}

/**
 * Remove leftover staging worktrees. With `branch` set, only that branch's
 * `.finalize-<branch>-*` dirs go (every finalize prunes its own branch's
 * stale attempts before starting); without it, `giwt abort` prunes every
 * `.finalize-*` orphan in the tree dir.
 */
export function pruneStagingWorktrees(config: WorktreeConfig, branch?: string): void {
  if (!existsSync(config.treeDir)) return;
  const prefix = branch === undefined ? ".finalize-" : `.finalize-${branchToPath(branch)}-`;
  let removed = false;
  for (const entry of readdirSync(config.treeDir)) {
    if (!entry.startsWith(prefix)) continue;
    const dir = join(config.treeDir, entry);
    const result = spawnGit(["worktree", "remove", "--force", dir], config.repoRoot);
    if (result.exitCode !== 0) {
      // Not a registered worktree (e.g. SIGKILL between mkdir and register):
      // drop the directory so it cannot accumulate.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
    removed = true;
  }
  if (removed) spawnGit(["worktree", "prune"], config.repoRoot);
}

export function removeStaging(config: WorktreeConfig, stagingDir: string): void {
  spawnGit(["worktree", "remove", "--force", stagingDir], config.repoRoot);
  spawnGit(["worktree", "prune"], config.repoRoot);
}

export function checkoutTargetInStaging(stagingDir: string, targetBranch: string): void {
  const co = spawnGit(["checkout", "--quiet", "--detach", targetBranch], stagingDir);
  if (co.exitCode !== 0) {
    log("error", `failed to check out ${targetBranch} in the staging worktree`);
    raw(`  Stderr: ${co.stderr.trim()}`);
    process.exit(1);
  }
}
