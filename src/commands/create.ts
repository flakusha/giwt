// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { branchToPath, linkWorktreeCredentials } from "../utils/config";
import { gitSync, isProtected } from "../utils/git";
import { linkNodeModules } from "../utils/modules";
import { log, raw } from "../utils/output";

export async function execute(
  args: string[],
  config: Awaited<ReturnType<typeof import("../index").loadConfig>>,
): Promise<void> {
  const branch = args[0];
  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt create <branch>");
    process.exit(1);
  }

  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot create worktree for protected branch '${branch}'`);
    process.exit(1);
  }

  // Verify branch exists
  try {
    gitSync(config.repoRoot, "rev-parse", "--verify", branch);
  } catch {
    log("error", `branch '${branch}' does not exist`);
    process.exit(1);
  }

  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);

  if (existsSync(wtPath)) {
    log("warn", `worktree already exists: ${wtPath}`);
    return;
  }

  // Ensure tree dir
  mkdirSync(config.treeDir, { recursive: true });

  log("info", `Creating worktree for branch: ${branch}`);

  const result = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "worktree", "add", wtPath, branch],
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
