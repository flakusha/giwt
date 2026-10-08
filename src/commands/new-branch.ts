// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import {
  branchToPath,
  configureGpgSigningSilently,
  linkWorktreeCredentials,
  type WorktreeConfig,
} from "../utils/config";
import { gitConfigSet } from "../utils/config-writes";
import { reportMissingBase } from "../utils/errors";
import { gitSync, gitSyncQuiet, isolatedGitEnv, isProtected } from "../utils/git";
import { linkNodeModules } from "../utils/modules";
import { log, raw } from "../utils/output";
import { applyScopedTickets, parseScopeFlags, resolveScopedTickets } from "./scoped-worktree";

export async function execute(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { scope, tickets, rest } = parseScopeFlags(args);
  const branch = rest[0];
  const base = rest[1] ?? config.settings.branches.root;

  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt new-branch <branch> [base]");
    process.exit(1);
  }
  // Pre-flight: unknown ticket ids refuse before any git mutation.
  if (tickets !== undefined) resolveScopedTickets(config, tickets);

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
  const result = Bun.spawnSync([
    "git",
    "-C",
    config.repoRoot,
    "worktree",
    "add",
    "-b",
    branch,
    wtPath,
    base,
  ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    log("error", `worktree add failed (exit ${result.exitCode})`);
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  // Configure GPG signing (silent on cold cache — see configureGpgSigningSilently).
  configureGpgSigningSilently(wtPath, config.agentGpgKeyId);

  // Configure hooks
  const hooksDir = resolve(config.repoRoot, ".githooks");
  if (existsSync(hooksDir)) {
    gitConfigSet({
      root: wtPath,
      entries: [{ key: "core.hooksPath", value: hooksDir }],
      reason: "hooksPath install (giwt new)",
    });
    log("success", "hooks configured");
  }

  // Warn when the repo has no configured identity — commits will fail later
  const repoEmail = gitSyncQuiet(config.repoRoot, "config", "user.email");
  if (!repoEmail) {
    log("warn", "repo has no user.email configured — commits will fail until you set it");
    raw("  Run: git config user.email 'you@example.com' && git config user.name 'Your Name'");
  }

  linkNodeModules(config.repoRoot, wtPath);

  linkWorktreeCredentials(config.repoRoot, wtPath);

  if (tickets !== undefined || scope !== undefined) {
    applyScopedTickets(config, wtPath, scope, tickets ?? []);
  }

  log("success", `Created: ${wtPath}`);
}
