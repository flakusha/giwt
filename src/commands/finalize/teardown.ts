// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import type { WorktreeConfig } from "../../utils/config";
import { isolatedGitEnv } from "../../utils/git";
import { appendGripe } from "../../utils/ledger";
import { log, raw } from "../../utils/output";
import { activeRun } from "../../utils/runlog";

/**
 * Finalize teardown: remove the worktree (Step 6) and delete its branch
 * (Step 7, forced when the plain -d refuses), then print the closing
 * summary. Part of finalize's contract even when the target already
 * contained the branch — skipping leaks the worktree directory, its
 * .git/worktrees admin entry, and the branch ref while reporting success.
 *
 * Failures are fatal: a worktree that cannot be removed (or a branch that
 * cannot be deleted at all) exits 1 instead of falling through to the
 * success summary. A worktree dir removed externally between the merge and
 * the teardown is handled gracefully: the stale registration is pruned and
 * the branch deletion still proceeds.
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
  if (!existsSync(wtPath)) {
    log("info", "Worktree already removed externally — pruning stale registration");
    Bun.spawnSync(["git", "worktree", "prune"], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
      cwd: config.repoRoot,
    });
  } else {
    const removeResult = Bun.spawnSync(["git", "worktree", "remove", wtPath, "--force"], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
      cwd: config.repoRoot,
    });
    if (removeResult.exitCode !== 0) {
      const stderr = removeResult.stderr.toString().trim();
      log("error", `Failed to remove worktree: ${stderr}`);
      raw(`  Remove manually: git worktree remove ${wtPath}`);
      appendGripe(
        config.treeDir,
        branch,
        `finalize ${branch}: failed to remove worktree: ${stderr}`,
      );
      activeRun()?.outcome({ failedGates: ["teardown"] });
      process.exit(1);
    }
    log("success", "Worktree removed");
  }

  // Step 7: Delete branch
  log("info", "Step 7: Deleting branch...");
  const tip = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "rev-parse", `refs/heads/${branch}`],
    { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
  ).stdout.toString().trim();
  const deleteResult = Bun.spawnSync(["git", "-C", config.repoRoot, "branch", "-d", branch], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (deleteResult.exitCode === 0) {
    log("success", "Branch deleted");
  } else {
    log("warn", `branch -d refused: ${deleteResult.stderr.toString().trim()}`);
    log(
      "warn",
      `Force-deleting '${branch}' — unmerged commits discarded; tip ${tip} recoverable from reflog`,
    );
    const forceResult = Bun.spawnSync(
      ["git", "-C", config.repoRoot, "branch", "-D", branch],
      { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
    );
    if (forceResult.exitCode !== 0) {
      log("error", `Failed to delete branch '${branch}': ${forceResult.stderr.toString().trim()}`);
      process.exit(1);
    }
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
