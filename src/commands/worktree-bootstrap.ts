// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  configureGpgSigningSilently,
  linkWorktreeCredentials,
  type WorktreeConfig,
} from "../utils/config";
import { gitConfigSet } from "../utils/config-writes";
import { gitSyncQuiet, isolatedGitEnv, isProtected } from "../utils/git";
import { linkNodeModules } from "../utils/modules";
import { log, raw } from "../utils/output";

/** Protected-branch refusal shared by the create/new-branch pre-flights:
 *  must run before any git mutation and before the callers' own
 *  branch/base existence checks (whose error text would otherwise mask
 *  the protected-branch refusal). */
export function refuseProtectedBranch(branch: string, config: WorktreeConfig): void {
  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot create worktree for protected branch '${branch}'`);
    process.exit(1);
  }
}

export interface BootstrapOptions {
  config: WorktreeConfig;
  wtPath: string;
  branch: string;
  /** When set, the worktree branches off this ref (`worktree add -b
   *  <branch> <path> <base>`); when omitted, the branch must already
   *  exist (`worktree add <path> <branch>`). */
  base?: string;
  /** Per-caller config-writes audit reason for the hooksPath install
   *  ("hooksPath install (giwt create)" vs "(giwt new)"). */
  hooksReason: string;
}

/** Shared worktree bootstrap tail for `create`/`new-branch`: protected-
 *  branch refusal, the `worktree add` spawn, GPG signing setup, hooksPath
 *  install, identity warn, and the node_modules/credentials links. The
 *  callers keep their own pre-flight/registration logic and the per-caller
 *  log lines. */
export async function bootstrapWorktree(
  { config, wtPath, branch, base, hooksReason }: BootstrapOptions,
): Promise<void> {
  // Ensure tree dir
  mkdirSync(config.treeDir, { recursive: true });

  const addArgs = base !== undefined
    ? ["worktree", "add", "-b", branch, wtPath, base]
    : ["worktree", "add", wtPath, branch];
  const result = Bun.spawnSync(["git", "-C", config.repoRoot, ...addArgs], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
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
      reason: hooksReason,
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
}
