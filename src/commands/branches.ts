// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Branches command - list branches with status
 */

import { getBranches, getStatus, getWorktrees, isProtected } from "../utils/git";
import { colorize, raw, section } from "../utils/output";

export async function execute(
  _args: string[],
  config: Awaited<ReturnType<typeof import("../index").loadConfig>>,
): Promise<void> {
  const { repoRoot } = config;

  section("Branches");

  const branches = await getBranches(repoRoot, config.settings.branches.protected);
  const worktrees = await getWorktrees(repoRoot);
  const worktreeBranches = new Set(worktrees.map(wt => wt.branch.replace("refs/heads/", "")));

  for (const branch of branches) {
    const status = await getStatus(repoRoot, branch.name);
    const inWorktree = worktreeBranches.has(branch.name);
    const prefix = branch.current ? "*" : " ";

    let statusText = "";
    if (status.ahead > 0) {
      statusText = colorize(`(ahead ${status.ahead})`, "green");
    } else if (status.behind > 0) {
      statusText = colorize(`(behind ${status.behind})`, "yellow");
    } else {
      statusText = "(up to date)";
    }

    let worktreeMarker = "";
    if (inWorktree) {
      worktreeMarker = colorize(" [wt]", "cyan");
    }

    let protectedMarker = "";
    if (isProtected(branch.name, config.settings.branches.protected)) {
      protectedMarker = colorize(" (protected)", "gray");
    }

    raw(`  ${prefix}${branch.name}${worktreeMarker}${protectedMarker} ${statusText}`);
  }

  raw("");
}
