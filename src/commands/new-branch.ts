// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import { resolve } from "path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { reportMissingBase } from "../utils/errors";
import { gitSync } from "../utils/git";
import { log, outcomeLine } from "../utils/output";
import { applyScopedTickets, parseScopeFlags, resolveScopedTickets } from "./scoped-worktree";
import { bootstrapWorktree, refuseProtectedBranch } from "./worktree-bootstrap";

export async function execute(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { scope, tickets, rest } = parseScopeFlags(args);
  const branch = rest[0];
  const base = rest[1] ?? config.settings.branches.root;

  if (!branch) {
    log("error", "branch name required");
    log("error", "usage: giwt new-branch <branch> [base]");
    process.exit(1);
  }
  // Pre-flight: unknown ticket ids refuse before any git mutation.
  if (tickets !== undefined) resolveScopedTickets(config, tickets);

  refuseProtectedBranch(branch, config);

  // Check branch doesn't already exist
  try {
    gitSync(config.repoRoot, "rev-parse", "--verify", `refs/heads/${branch}`);
    log("error", `branch '${branch}' already exists`);
    process.exit(1);
  } catch {
    // branch doesn't exist — good
  }

  // Verify base exists (accepts branch name, tag, or commit)
  try {
    gitSync(config.repoRoot, "rev-parse", "--verify", base);
  } catch {
    reportMissingBase(base, branch, config);
    process.exit(1);
  }

  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);

  if (existsSync(wtPath)) {
    log("warn", `worktree already exists: ${wtPath}`);
    outcomeLine(true, `worktree already exists: ${wtPath}`);
    return;
  }

  log("info", `Creating new branch '${branch}' from '${base}'`);

  // Branch off `base` (the caller-supplied ref, or the default `dev`). Using
  // the resolved ref directly works whether `base` is a branch, tag, or commit.
  await bootstrapWorktree({
    config,
    wtPath,
    branch,
    base,
    hooksReason: "hooksPath install (giwt new)",
  });

  if (tickets !== undefined || scope !== undefined) {
    applyScopedTickets(config, wtPath, scope, tickets ?? []);
  }

  log("success", `Created: ${wtPath}`);
  outcomeLine(true, `created ${wtPath}`);
}
