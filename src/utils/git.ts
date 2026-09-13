// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Git operation utilities for worktree management
 */

import { resolve } from "node:path";
import { log, raw } from "./output";
import { DEFAULT_SETTINGS } from "./settings";

export interface GitBranch {
  name: string;
  current: boolean;
  protected: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string;
  HEAD: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
}

/** Fallback when no config is in scope; the settings layer owns the real default. */
const PROTECTED_BRANCHES = DEFAULT_SETTINGS.branches.protected;

export function isProtected(
  branch: string,
  protectedBranches: readonly string[] = PROTECTED_BRANCHES,
): boolean {
  return protectedBranches.includes(branch);
}

/**
 * Current branch of the main checkout - the base feature branches fork
 * from (e.g. `dev`). Falls back to `master` when HEAD is detached.
 */
export function getRootBranch(repoRoot: string): string {
  return gitSync(repoRoot, "branch", "--show-current") || "master";
}

/**
 * Resolve the *main* repo root for a git checkout regardless of cwd.
 *
 * Works correctly from any linked worktree: `--git-common-dir` returns the
 * shared `.git` directory (lives at the main repo root), so `dirname` of that
 * is always the main repo. From the main repo itself the same call returns
 * the local `.git`, whose parent is the main repo. Resolves relative paths
 * (e.g. `.git`) against `startDir` before computing the parent.
 *
 * Use this instead of `import.meta.url`-derived paths whenever the CLI is
 * launched from inside a worktree — `giwt ...` resolves
 * the script path relative to cwd, which would otherwise point into the
 * worktree and yield a wrong repoRoot.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  const commonDir = gitSyncQuiet(startDir, "rev-parse", "--git-common-dir");
  if (!commonDir) {
    throw new Error(`findRepoRoot: not a git repository (cwd: ${startDir})`);
  }
  return resolve(startDir, commonDir, "..");
}

/**
 * Resolve the top-level of the checkout `startDir` belongs to — the main
 * repo root when run there, or the linked worktree root when run inside
 * `tree/<branch>`. Use this for plan-file reads/writes so they land in the
 * tree the user is actually working in; `findRepoRoot()` intentionally
 * resolves to the *main* root (shared issue store, credentials) even from
 * inside a linked worktree.
 *
 * @param startDir - directory to resolve from; defaults to `process.cwd()`
 * @returns absolute top-level path of the current worktree checkout
 * @throws when `startDir` is not inside a git repository
 */
export function getWorktreeRoot(startDir: string = process.cwd()): string {
  const toplevel = gitSyncQuiet(startDir, "rev-parse", "--show-toplevel");
  if (!toplevel) {
    throw new Error(`getWorktreeRoot: not a git repository (cwd: ${startDir})`);
  }
  return toplevel;
}

/**
 * True when `cwd` lies inside a linked worktree (e.g. tree/<branch>) rather
 * than the main repo root. Detection is git-aware (uses rev-parse) so it works
 * regardless of how the CLI was launched or which checkout's copy is running:
 * in a linked worktree `--show-toplevel` differs from the parent of
 * `--git-common-dir` (the shared .git).
 */
function isInsideWorktree(cwd: string = process.cwd()): boolean {
  try {
    const toplevel = gitSync(cwd, "rev-parse", "--show-toplevel").trim();
    const mainRoot = findRepoRoot(cwd);
    return toplevel !== mainRoot;
  } catch {
    return false;
  }
}

/**
 * Fail fast if a worktree-management command is run from inside a linked
 * worktree (tree/*) instead of the repo root.
 */
export function assertNotInWorktree(command: string): void {
  if (isInsideWorktree()) {
    log(
      "error",
      String(
        `command '${command}' must be run from the repo root, not inside a worktree (tree/*)`,
      ).replace(/\n$/, ""),
    );
    raw("  cd to the repo root and re-run: giwt " + command);
    process.exit(1);
  }
}

/**
 * Run git in repoRoot. Throws on non-zero exit — callers use try/catch for
 * existence checks (rev-parse --verify). Use gitSyncQuiet for reads where a
 * non-zero exit is a legit empty result (e.g. unset git config).
 */
export function gitSync(repoRoot: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repoRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `git ${args.join(" ")} failed (exit ${result.exitCode})`);
  }
  return result.stdout.toString().trim();
}

/** Like gitSync but returns stdout even on non-zero exit (never throws). */
export function gitSyncQuiet(repoRoot: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repoRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.stdout.toString().trim();
}

/**
 * Staged paths that are dependency directories — never committable.
 * The worktree `node_modules` symlink (→ root install) is not matched by
 * dir-only ignore patterns, so `git add -A` can stage it silently; three
 * accidental commits came through this path before the guard existed.
 */
export function stagedDependencyPaths(root: string): string[] {
  return gitSyncQuiet(root, "diff", "--cached", "--name-only")
    .split("\n")
    .filter((p) => p === "node_modules" || p.split("/").includes("node_modules"));
}

export async function getBranches(
  repoRoot: string,
  protectedBranches: readonly string[] = PROTECTED_BRANCHES,
): Promise<GitBranch[]> {
  const output = gitSync(repoRoot, "branch", "--format=%(refname:short)");
  const current = gitSync(repoRoot, "branch", "--show-current");
  return output
    .split("\n")
    .filter((b) => b.trim())
    .map((b) => ({
      name: b.trim().replace(/^\* /, ""),
      current: b.trim() === current,
      protected: protectedBranches.includes(b.trim()),
    }));
}

export async function getWorktrees(repoRoot: string): Promise<GitWorktree[]> {
  const output = gitSync(repoRoot, "worktree", "list", "--porcelain");
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | null = null;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Porcelain format: first line after blank is "worktree <path>"
    // or bare path on older git versions
    if (trimmed.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: trimmed.slice(9), branch: "", HEAD: "" };
    } else if (trimmed.startsWith("HEAD ")) {
      if (current) current.HEAD = trimmed.slice(5);
    } else if (trimmed.startsWith("branch ")) {
      if (current) current.branch = trimmed.slice(7);
    } else if (!current && !trimmed.startsWith("bare") && !trimmed.startsWith("detached")) {
      // Older git: bare path on first line
      current = { path: trimmed, branch: "", HEAD: "" };
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

export async function getStatus(
  repoRoot: string,
  branch: string,
): Promise<GitStatus> {
  const base = getRootBranch(repoRoot);
  const aheadStr = gitSync(repoRoot, "rev-list", "--count", `${base}..${branch}`);
  const behindStr = gitSync(repoRoot, "rev-list", "--count", `${branch}..${base}`);
  const ahead = parseInt(aheadStr || "0", 10);
  const behind = parseInt(behindStr || "0", 10);
  const dirty = gitSyncQuiet(repoRoot, "status", "--porcelain");
  return {
    branch,
    ahead,
    behind,
    clean: dirty === "",
  };
}
