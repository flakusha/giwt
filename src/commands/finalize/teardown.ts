// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../../utils/config";
import { isolatedGitEnv } from "../../utils/git";
import { log, raw } from "../../utils/output";

/**
 * Finalize teardown: remove the worktree (Step 6) and delete its branch
 * (Step 7, forced when the plain -d refuses), then print the closing
 * summary. Part of finalize's contract even when the target already
 * contained the branch — skipping leaks the worktree directory, its
 * .git/worktrees admin entry, and the branch ref while reporting success.
 */
export function teardownFinalizedWorktree(
  branch: string,
  wtPath: string,
  config: WorktreeConfig,
  alreadyMerged: boolean,
  targetBranch: string,
): void {
  // Step 6: Remove worktree
  log("info", "Step 6: Removing worktree...");
  const removeResult = Bun.spawnSync(["git", "worktree", "remove", wtPath, "--force"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
    cwd: config.repoRoot,
  });
  if (removeResult.exitCode === 0) {
    log("success", "Worktree removed");
  } else {
    log("warn", `Failed to remove worktree — remove manually: git worktree remove ${wtPath}`);
  }

  // Step 7: Delete branch
  log("info", "Step 7: Deleting branch...");
  const deleteResult = Bun.spawnSync(["git", "-C", config.repoRoot, "branch", "-d", branch], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (deleteResult.exitCode === 0) {
    log("success", "Branch deleted");
  } else {
    // Force delete
    Bun.spawnSync(["git", "-C", config.repoRoot, "branch", "-D", branch], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    log("success", "Branch deleted (forced)");
  }

  raw("");
  log(
    "success",
    alreadyMerged
      ? `Finalized '${branch}' — already contained in ${targetBranch}`
      : `Finalized '${branch}' — merged to ${targetBranch}`,
  );
}
