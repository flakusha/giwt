// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Branches command - list branches with status
 */

import { isProtected } from "../utils/git";
import { colorize, raw, section } from "../utils/output";
import { resolveVcsBackend } from "../vcs/registry";

export async function execute(
  _args: string[],
  config: Awaited<ReturnType<typeof import("../index").loadConfig>>,
): Promise<void> {
  const { repoRoot } = config;

  section("Branches");

  const backend = resolveVcsBackend(config.settings);
  const branches = await backend.listBranches(repoRoot);
  const worktrees = await backend.listWorkspaces(repoRoot);
  const worktreeBranches = new Set(worktrees.map(wt => wt.branch));

  for (const branch of branches) {
    const status = await backend.status(repoRoot, branch.name);
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
