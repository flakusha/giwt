// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, mkdirSync, rmdirSync } from "fs";
import { resolve } from "path";
import { branchToPath, linkWorktreeCredentials, type WorktreeConfig } from "../utils/config";
import { gitSync, isProtected } from "../utils/git";
import { linkNodeModules } from "../utils/modules";
import { log, raw } from "../utils/output";
import {
  hasWorktreeDir,
  isDirEmpty,
  pruneStaleRegistrations,
  recoverableHead,
  registrationFor,
} from "./worktree-registry";

export async function execute(args: string[], config: WorktreeConfig): Promise<void> {
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

  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);

  // Verify branch exists. When the ref is gone but a stale worktree
  // registration survives (directory and ref deleted behind git's back),
  // recover the branch from the registration's last-known HEAD instead of
  // failing — ticket FIX-stale-worktree-registry.
  try {
    gitSync(config.repoRoot, "rev-parse", "--verify", branch);
  } catch {
    if (!(await recoverDeletedBranch(config, wtPath, branch))) {
      log(
        "error",
        `branch '${branch}' does not exist — create it first: git branch ${branch} <base>, or giwt new ${branch}`,
      );
      process.exit(1);
    }
  }

  // Reconcile the registry before adding: git refuses to add into a path
  // with a stale registration, and "already exists" is wrong when nothing
  // usable is registered at the path.
  //
  // registration | usable dir | action
  // --------------|------------|---------------------------------
  //     yes       |     yes    | warn "already exists", stop
  //     yes       |     no     | prune stale registration, add
  //     no        |     yes    | empty husk: clear + add; non-empty: warn, stop
  //     no        |     no     | plain add
  const registration = await registrationFor(config.repoRoot, wtPath);
  if (registration && hasWorktreeDir(wtPath)) {
    log("warn", `worktree already exists: ${wtPath}`);
    return;
  }
  if (registration) {
    log("info", `pruning stale worktree registration: ${wtPath} (directory missing)`);
    pruneStaleRegistrations(config.repoRoot);
  } else if (existsSync(wtPath)) {
    // Directory exists but git has no registration: an empty leftover husk
    // (e.g. from a crashed add) can be cleared; a non-empty directory
    // belongs to the user.
    if (isDirEmpty(wtPath)) {
      rmdirSync(wtPath);
      log("info", `removed empty leftover directory: ${wtPath}`);
    } else {
      log(
        "warn",
        `directory exists but is not a registered worktree: ${wtPath} — inspect and remove it first: rm -rf ${wtPath}`,
      );
      return;
    }
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

/**
 * Restore a branch whose ref was deleted while a stale worktree
 * registration survived at this branch's path. Returns true when the
 * branch exists again — recovered from the registration's last-known HEAD
 * (a real sha; all-zeros means a dangling symref, nothing recoverable).
 * The stale registration is pruned before any recovery attempt so the
 * registry ends up clean even when the caller still errors out.
 */
async function recoverDeletedBranch(
  config: WorktreeConfig,
  wtPath: string,
  branch: string,
): Promise<boolean> {
  const registration = await registrationFor(config.repoRoot, wtPath);
  if (!registration || hasWorktreeDir(wtPath)) return false;
  const head = recoverableHead(registration);
  pruneStaleRegistrations(config.repoRoot);
  log("info", `pruned stale worktree registration: ${wtPath} (directory missing)`);
  if (!head) return false;
  try {
    gitSync(config.repoRoot, "branch", branch, head);
  } catch {
    log(
      "error",
      `branch '${branch}' does not exist and cannot be recovered — last known commit ${
        head.slice(0, 8)
      } is gone; recreate it: git branch ${branch} <base>`,
    );
    process.exit(1);
  }
  log(
    "info",
    `recovered branch '${branch}' at ${head.slice(0, 8)} from stale worktree registration`,
  );
  return true;
}
