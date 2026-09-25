// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { findWorktree, type WorktreeConfig } from "../utils/config";
import { getRootBranch, gitSync, isProtected } from "../utils/git";
import { log, raw } from "../utils/output";

export async function rebase(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const [branch, onto] = args;
  const target = onto || getRootBranch(config.repoRoot);

  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt rebase <branch> [onto]");
    process.exit(1);
  }

  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot rebase protected branch '${branch}'`);
    process.exit(1);
  }

  const wtPath = findWorktree(branch, config);
  if (!wtPath) {
    log("error", `no worktree found for branch '${branch}'`);
    process.exit(1);
  }

  // Verify target branch exists
  try {
    gitSync(config.repoRoot, "rev-parse", "--verify", target);
  } catch {
    log("error", `target branch '${target}' does not exist`);
    process.exit(1);
  }

  // Check worktree clean
  const dirty = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--quiet"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const staged = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--cached", "--quiet"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
    log("error", `uncommitted changes in worktree '${branch}'`);
    process.exit(1);
  }

  log("info", `Rebasing '${branch}' onto '${target}'...`);

  const result = Bun.spawnSync(
    ["git", "-C", wtPath, "rebase", target],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (result.exitCode !== 0) {
    log("error", `rebase failed — resolve conflicts in ${wtPath}`);
    raw(`  Then: cd ${wtPath} && git rebase --continue`);
    raw(`  Or:   cd ${wtPath} && git rebase --abort`);
    process.exit(1);
  }

  log("success", `Rebased '${branch}' onto '${target}'`);
}
