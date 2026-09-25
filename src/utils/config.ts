// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Configuration utilities for worktree management
 */

import { existsSync, symlinkSync } from "fs";
import { dirname, resolve } from "path";
import { findRepoRoot, getWorktreeRoot, gitSync } from "./git";
import { log } from "./output";
import { type GiwtSettings, loadSettings } from "./settings";

export interface WorktreeConfig {
  repoRoot: string;
  /** Per-invocation checkout root: worktree root when invoked inside
   *  tree/<branch>, otherwise identical to repoRoot. Plan-file sync lands
   *  here, not in the main checkout. Run records do NOT: they live under
   *  repoRoot so a finalize that removes this tree keeps its evidence. */
  worktreeRoot: string;
  treeDir: string;
  /** Effective layered settings (defaults < global < local file). */
  settings: GiwtSettings;
  agentGpgKeyId?: string;
  agentGpgName?: string;
  agentGpgEmail?: string;
}

async function findCredentials(startDir: string): Promise<string | null> {
  let dir = startDir;
  while (dir !== "/") {
    const credentialsPath = resolve(dir, ".credentials.env");
    const exists = await Bun.file(credentialsPath).exists();
    if (exists) {
      return dir;
    }
    dir = dirname(dir);
  }
  return null;
}

/** Strip surrounding quotes (shell .env style) — old shell eval stripped them implicitly. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export async function loadConfig(): Promise<WorktreeConfig> {
  // Resolve the main repo root via git so the CLI works correctly when
  // invoked from inside a linked worktree (tree/<branch>). REPO_ROOT remains
  // an opt-in escape hatch for CI / non-standard layouts.
  const repoRoot = process.env.REPO_ROOT ?? findRepoRoot();
  // REPO_ROOT (CI escape hatch) pins the invocation root to the same root;
  // otherwise resolve the checkout actually running so worktree invocations
  // keep their run records and plan files local.
  const worktreeRoot = process.env.REPO_ROOT ? repoRoot : getWorktreeRoot();
  const settings = loadSettings(repoRoot);
  const treeDir = process.env.TREE_DIR ?? resolve(repoRoot, settings.paths.tree);

  // Load agent credentials from main repo
  const mainRepoRoot = await findCredentials(repoRoot);
  let agentGpgKeyId: string | undefined;
  let agentGpgName: string | undefined;
  let agentGpgEmail: string | undefined;

  if (mainRepoRoot) {
    const credentialsPath = resolve(mainRepoRoot, ".credentials.env");
    const content = await Bun.file(credentialsPath).text();
    for (const line of content.split("\n")) {
      if (line.startsWith("AGENT_GPG_KEY_ID=")) {
        agentGpgKeyId = unquote(line.split("=")[1]!);
      } else if (line.startsWith("AGENT_GPG_NAME=")) {
        agentGpgName = unquote(line.split("=")[1]!);
      } else if (line.startsWith("AGENT_GPG_EMAIL=")) {
        agentGpgEmail = unquote(line.split("=")[1]!);
      }
    }
  }

  return {
    repoRoot,
    worktreeRoot,
    treeDir,
    settings,
    ...(agentGpgKeyId !== undefined && { agentGpgKeyId }),
    ...(agentGpgName !== undefined && { agentGpgName }),
    ...(agentGpgEmail !== undefined && { agentGpgEmail }),
  };
}

export function branchToPath(branch: string): string {
  return branch.replace(/\//g, "-");
}

/**
 * Configure `commit.gpgsign` and `user.signingkey` for a freshly-created
 * worktree. Silent on cold cache: only logs success when both the public
 * AND secret keys are present, so a missing-key environment silently
 * falls back to unsigned commits (matches the prior create/new-branch
 * behavior). Use `assertAgentGpgUnlocked` from utils/gpg.ts for the
 * exit-on-cold path that sign.ts and merge.ts take.
 */
export function configureGpgSigningSilently(
  wtPath: string,
  agentGpgKeyId: string | undefined,
): void {
  if (!agentGpgKeyId) return;
  const gpgCheck = Bun.spawnSync(
    ["gpg", "--list-keys", agentGpgKeyId],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (gpgCheck.exitCode !== 0) return;
  const secretCheck = Bun.spawnSync(
    ["gpg", "--list-secret-keys", agentGpgKeyId],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (secretCheck.exitCode !== 0) return;
  gitSync(wtPath, "config", "commit.gpgsign", "true");
  gitSync(wtPath, "config", "user.signingkey", agentGpgKeyId);
  log("success", `GPG signing enabled (key: ${agentGpgKeyId.slice(0, 8)}...)`);
}

export function findWorktree(branch: string, config: WorktreeConfig): string | null {
  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);
  if (existsSync(resolve(wtPath, ".git"))) return wtPath;
  return null;
}

/**
 * Symlink root `.credentials.env` into a worktree so worktree-local scripts
 * (gpg-unlock) find agent GPG identity without a
 * parent-walk. Mirrors the node_modules symlink: same pattern, same
 * idempotency, same skip-if-present.
 * @param repoRoot
 * @param wtPath
 */
export function linkWorktreeCredentials(repoRoot: string, wtPath: string): void {
  const mainCreds = resolve(repoRoot, ".credentials.env");
  const wtCreds = resolve(wtPath, ".credentials.env");
  if (existsSync(mainCreds) && !existsSync(wtCreds)) {
    symlinkSync(mainCreds, wtCreds);
    log("success", ".credentials.env linked");
  }
}

export async function resolveBranch(
  repoRoot: string,
  input: string,
): Promise<string> {
  // Check if it's a valid branch
  try {
    gitSync(repoRoot, "rev-parse", "--verify", input);
    return input;
  } catch {
    // Try as directory name
    const dirName = branchToPath(input);
    const worktreePath = resolve(repoRoot, "tree", dirName);
    const gitExists = await Bun.file(resolve(worktreePath, ".git")).exists();
    if (gitExists) {
      const headRef = gitSync(worktreePath, "symbolic-ref", "--short", "HEAD");
      if (headRef) return headRef;
    }
    return "";
  }
}
