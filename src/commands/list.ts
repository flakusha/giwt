// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * List command — show all worktrees with status
 */

import type { WorktreeConfig } from "../utils/config";
import { getStatus, getWorktrees } from "../utils/git";
import { colorize, log, raw, section } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";

export async function listWorktrees(
  _args?: string[],
  config?: WorktreeConfig,
): Promise<void> {
  const protectedBranches = config?.settings.branches.protected
    ?? DEFAULT_SETTINGS.branches.protected;
  const repoRoot = config?.repoRoot;
  const worktrees = await getWorktrees(repoRoot!);

  if (worktrees.length === 0) {
    log("info", "No worktrees found");
    return;
  }

  section("Worktrees");

  for (const wt of worktrees) {
    const branch = wt.branch.replace("refs/heads/", "");
    const isProt = protectedBranches.includes(branch);

    const label = isProt
      ? `${colorize(branch, "gray")} ${colorize("(protected)", "gray")}`
      : colorize(branch, "cyan");

    raw(`\n  ${label}`);
    raw(`    path: ${wt.path}`);

    try {
      const status = await getStatus(repoRoot!, branch);
      const headShort = wt.HEAD.slice(0, 8);

      let syncLabel = "";
      if (status.ahead > 0 && status.behind > 0) {
        syncLabel = `${colorize(`ahead ${status.ahead}`, "green")} ${
          colorize(`behind ${status.behind}`, "red")
        }`;
      } else if (status.ahead > 0) {
        syncLabel = colorize(`ahead ${status.ahead}`, "green");
      } else if (status.behind > 0) {
        syncLabel = colorize(`behind ${status.behind}`, "red");
      } else {
        syncLabel = "up to date";
      }

      raw(`    HEAD: ${headShort} — ${syncLabel}`);
    } catch {
      raw(`    HEAD: ${wt.HEAD.slice(0, 8)}`);
    }
  }

  raw("");
}
