// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import { resolve } from "path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { assertAgentGpgUnlocked } from "../utils/gpg";
import { log, raw } from "../utils/output";

function gpgMergeFlags(config: WorktreeConfig): string[] {
  if (!config.agentGpgKeyId) return [];
  const gpgCheck = Bun.spawnSync(
    ["gpg", "--list-secret-keys", config.agentGpgKeyId],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (gpgCheck.exitCode !== 0) return [];
  return [
    "-c",
    "commit.gpgsign=true",
    "-c",
    `user.signingkey=${config.agentGpgKeyId}`,
  ];
}

function findWorktree(branch: string, config: WorktreeConfig): string | null {
  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);
  if (existsSync(resolve(wtPath, ".git"))) return wtPath;
  return null;
}

export async function merge(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const [branch, source] = args;

  if (!branch || !source) {
    log("error", "branch and source required");
    raw("  Usage: giwt merge <branch> <source>");
    process.exit(1);
  }

  const wtPath = findWorktree(branch, config);
  if (!wtPath) {
    log("error", `no worktree found for branch '${branch}'`);
    process.exit(1);
  }

  // Verify source branch exists
  try {
    gitSync(config.repoRoot, "rev-parse", "--verify", source);
  } catch {
    log("error", `source branch '${source}' does not exist`);
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
  // Verify GPG is configured AND unlocked — exits 1 on cold cache.
  // This is the gate that previously let merge.ts silently produce an
  // unsigned merge when gpgMergeFlags() returned [] on cold cache.
  assertAgentGpgUnlocked();

  const flags = gpgMergeFlags(config);
  log("info", `Merging '${source}' into '${branch}'...`);

  const result = Bun.spawnSync(
    ["git", "-C", wtPath, ...flags, "merge", source, "--no-edit"],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (result.exitCode !== 0) {
    log("error", `merge failed — resolve conflicts in ${wtPath}`);
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  log("success", `Merged '${source}' into '${branch}'`);
}
