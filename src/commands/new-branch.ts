// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { branchToPath, linkWorktreeCredentials, type WorktreeConfig } from "../utils/config";
import { gitSync, isProtected } from "../utils/git";
import { linkNodeModules } from "../utils/modules";
import { log, raw } from "../utils/output";

/**
 * Report a missing base ref with everything needed to proceed without
 * trial-and-error: the existing branch candidates, the [branches] root
 * override in giwt.toml, and the explicit-base escape hatch.
 * Ticket FIX-errors-carry-no-remedy. Output-only; the caller exits.
 */
function reportMissingBase(
  base: string,
  branch: string,
  config: WorktreeConfig,
): void {
  log("error", `base '${base}' does not exist (checked as branch, tag, and commit)`);
  const candidates = gitSync(config.repoRoot, "branch", "--format=%(refname:short)")
    .split("\n")
    .map((b) => b.trim().replace(/^\* /, ""))
    .filter((b) => b.length > 0);
  if (candidates.length > 0) {
    raw(`  Existing branches you can base on: ${candidates.join(", ")}`);
  } else {
    raw("  No local branches exist yet — pass a commit or tag as the base instead.");
  }
  raw(
    `  Change the default base in giwt.toml: [branches] root = "<branch>" (currently '${config.settings.branches.root}').`,
  );
  raw(`  Or pass one explicitly: giwt new-branch ${branch} <base>`);
}

export async function execute(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const branch = args[0];
  const base = args[1] ?? config.settings.branches.root;

  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt new-branch <branch> [base]");
    process.exit(1);
  }

  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot create worktree for protected branch '${branch}'`);
    process.exit(1);
  }

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
    return;
  }

  mkdirSync(config.treeDir, { recursive: true });

  log("info", `Creating new branch '${branch}' from '${base}'`);

  // Branch off `base` (the caller-supplied ref, or the default `dev`). Using
  // the resolved ref directly works whether `base` is a branch, tag, or commit.
  const result = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "worktree", "add", "-b", branch, wtPath, base],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    log("error", `worktree add failed (exit ${result.exitCode})`);
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  // Configure GPG signing
  if (config.agentGpgKeyId) {
    const gpgCheck = Bun.spawnSync(
      ["gpg", "--list-keys", config.agentGpgKeyId],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (gpgCheck.exitCode === 0) {
      const secretCheck = Bun.spawnSync(
        ["gpg", "--list-secret-keys", config.agentGpgKeyId],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (secretCheck.exitCode === 0) {
        gitSync(wtPath, "config", "commit.gpgsign", "true");
        gitSync(wtPath, "config", "user.signingkey", config.agentGpgKeyId);
        log("success", `GPG signing enabled (key: ${config.agentGpgKeyId.slice(0, 8)}...)`);
      }
    }
  }

  // Configure hooks
  const hooksDir = resolve(config.repoRoot, ".githooks");
  if (existsSync(hooksDir)) {
    gitSync(wtPath, "config", "core.hooksPath", hooksDir);
    log("success", "hooks configured");
  }

  linkNodeModules(config.repoRoot, wtPath);

  linkWorktreeCredentials(config.repoRoot, wtPath);

  log("success", `Created: ${wtPath}`);
}
