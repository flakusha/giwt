// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { resolve } from "path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import { hasWorktreeDir, pruneStaleRegistrations, registrationFor } from "./worktree-registry";

export async function execute(args: string[], config: WorktreeConfig): Promise<void> {
  const branch = args[0];
  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt remove <branch>");
    process.exit(1);
  }

  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);

  if (!hasWorktreeDir(wtPath)) {
    const registration = await registrationFor(config.repoRoot, wtPath);
    if (registration) {
      // Stale registration: git still lists the worktree but its directory
      // is gone — prune the registration instead of erroring (ticket
      // FIX-stale-worktree-registry).
      log("info", `pruning stale worktree registration: ${wtPath} (directory missing)`);
      pruneStaleRegistrations(config.repoRoot);
      log("success", `pruned stale registration for branch '${branch}'`);
      return;
    }
    log(
      "error",
      `no worktree found for branch '${branch}' — create it first: giwt create ${branch}`,
    );
    process.exit(1);
  }

  // Check for dirty state
  const dirty = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--quiet"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const staged = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--cached", "--quiet"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
    log("error", `worktree has uncommitted changes`);
    raw(`  Stash or commit first: cd ${wtPath} && git stash`);
    process.exit(1);
  }

  log("info", `Removing worktree: ${wtPath}`);

  const result = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "worktree", "remove", wtPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    log("error", `worktree remove failed (exit ${result.exitCode})`);
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  log("success", "Removed");
}
