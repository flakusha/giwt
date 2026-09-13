// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, readdirSync, rmSync } from "fs";
import { resolve } from "path";
import { getWorktrees, gitSync } from "../utils/git";
import { colorize, log, raw } from "../utils/output";

export async function execute(
  _args: string[],
  config: Awaited<ReturnType<typeof import("../index").loadConfig>>,
): Promise<void> {
  if (!existsSync(config.treeDir)) {
    log("info", "no tree/ directory — nothing to clean");
    return;
  }

  log("info", "Checking for stale worktrees...");
  const worktrees = await getWorktrees(config.repoRoot);
  let removed = 0;

  const entries = readdirSync(config.treeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wtPath = resolve(config.treeDir, entry.name);

    // Find matching worktree entry
    const wt = worktrees.find(w => w.path === wtPath);
    if (!wt || !wt.branch) {
      raw(`  ${colorize("Skipped (detached HEAD):", "yellow")} ${wtPath}`);
      continue;
    }

    const branch = wt.branch.replace("refs/heads/", "");

    // Check if branch still exists
    try {
      gitSync(config.repoRoot, "rev-parse", "--verify", branch);
      raw(`  ${colorize("Kept:", "green")} ${wtPath} (branch '${branch}' exists)`);
    } catch {
      raw(`  ${colorize("Removing stale:", "red")} ${wtPath} (branch '${branch}' deleted)`);
      const result = Bun.spawnSync(
        ["git", "-C", config.repoRoot, "worktree", "remove", wtPath],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (result.exitCode === 0) {
        removed++;
      }
    }
  }

  // Clean up empty directories
  for (const entry of readdirSync(config.treeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = resolve(config.treeDir, entry.name);
    try {
      const remaining = readdirSync(dirPath);
      if (remaining.length === 0) {
        rmSync(dirPath, { recursive: true });
      }
    } catch {
      // skip
    }
  }

  log("success", `Cleanup complete: ${removed} worktree(s) removed`);
}
