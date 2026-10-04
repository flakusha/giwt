// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { resolve } from "path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { hasWorktreeDir, pruneStaleRegistrations, registrationFor } from "./worktree-registry";

export async function execute(args: string[], config: WorktreeConfig): Promise<void> {
  // Flag parsing: --branch-only / --force anywhere; unknown flags refused.
  const flags: string[] = [];
  const positionals: string[] = [];
  for (const arg of args) {
    if (arg === "--branch-only" || arg === "--force") flags.push(arg);
    else if (arg.startsWith("--")) {
      log("error", `unknown flag '${arg}'`);
      raw("  Usage: giwt remove <branch> [--branch-only] [--force]");
      process.exit(1);
    } else positionals.push(arg);
  }
  const branchOnly = flags.includes("--branch-only");
  const force = flags.includes("--force");

  const branch = positionals[0];
  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt remove <branch> [--branch-only] [--force]");
    process.exit(1);
  }

  if (branchOnly) {
    removeBranchOnly(branch, force, config);
    return;
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
      `no worktree found for branch '${branch}' — create it first: giwt create ${branch}`
        + " (or delete the branch alone: giwt remove <branch> --branch-only)",
    );
    process.exit(1);
  }

  // Check for dirty state
  const dirty = Bun.spawnSync(["git", "-C", wtPath, "diff", "--quiet"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const staged = Bun.spawnSync(["git", "-C", wtPath, "diff", "--cached", "--quiet"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
    log("error", `worktree has uncommitted changes`);
    raw(`  Stash or commit first: cd ${wtPath} && git stash`);
    process.exit(1);
  }

  log("info", `Removing worktree: ${wtPath}`);

  const result = Bun.spawnSync(["git", "-C", config.repoRoot, "worktree", "remove", wtPath], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    log("error", `worktree remove failed (exit ${result.exitCode})`);
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  // Post-removal branch cleanup: a fully merged branch is dead weight once
  // its worktree is gone (the common leftover after `giwt remove`).
  if (branchMerged(branch, config)) {
    gitRun(config.repoRoot, "branch", "-d", branch);
    log("success", `deleted merged branch '${branch}'`);
  } else {
    log(
      "info",
      `branch '${branch}' kept (unmerged) — delete it with: giwt remove ${branch} --branch-only`,
    );
  }

  log("success", "Removed");
}

/** Run git in cwd, returning stdout; throws on non-zero exit. */
function gitRun(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().replace(/\n$/, "");
}

/** True when `branch` is fully merged into the configured root branch.
 *  Falls back to the repo's current HEAD when the configured root ref does
 *  not exist (e.g. the "dev" default in a repo whose trunk is master) —
 *  otherwise every branch would read as unmerged and require --force. */
function branchMerged(branch: string, config: WorktreeConfig): boolean {
  const rootRef = `refs/heads/${config.settings.branches.root}`;
  const rootExists = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "rev-parse", "--verify", "--quiet", rootRef],
    { env: isolatedGitEnv(), stdout: "ignore", stderr: "ignore" },
  ).exitCode === 0;
  const target = rootExists ? config.settings.branches.root : "HEAD";
  const probe = Bun.spawnSync(
    [
      "git",
      "-C",
      config.repoRoot,
      "merge-base",
      "--is-ancestor",
      branch,
      target,
    ],
    { env: isolatedGitEnv(), stdout: "ignore", stderr: "ignore" },
  );
  return probe.exitCode === 0;
}

/** `giwt remove <branch> --branch-only` — delete a branch without a
 * worktree (the worktree was already removed by some earlier step).
 * Unmerged branches are refused unless --force; the tip SHA is always
 * reported so the commit stays recoverable from the reflog. */
function removeBranchOnly(branch: string, force: boolean, config: WorktreeConfig): void {
  const wtPath = resolve(config.treeDir, branchToPath(branch));
  if (hasWorktreeDir(wtPath)) {
    log(
      "error",
      `worktree for '${branch}' still exists at ${wtPath} — use plain: giwt remove ${branch}`,
    );
    process.exit(1);
  }

  const verify = Bun.spawnSync([
    "git",
    "-C",
    config.repoRoot,
    "rev-parse",
    "--verify",
    `refs/heads/${branch}`,
  ], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "ignore",
  });
  if (verify.exitCode !== 0) {
    log("error", `no such branch: '${branch}'`);
    process.exit(1);
  }
  const sha = verify.stdout.toString().trim();

  // git refuses any delete of the repo-root checkout (even -D) — surface a
  // remedy-carrying error instead of gitRun's raw throw on the --force path.
  const headRef = Bun.spawnSync(["git", "-C", config.repoRoot, "symbolic-ref", "--quiet", "HEAD"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "ignore",
  });
  if (headRef.exitCode === 0 && headRef.stdout.toString().trim() === `refs/heads/${branch}`) {
    log("error", `branch '${branch}' is checked out in ${config.repoRoot} — switch away first`);
    raw(`  Then: giwt remove ${branch} --branch-only${force ? " --force" : ""}`);
    process.exit(1);
  }

  if (!branchMerged(branch, config) && !force) {
    log("error", `branch '${branch}' is not fully merged (tip ${sha})`);
    raw(`  Recover later with: git branch -D ${branch} # or re-run with --force`);
    process.exit(1);
  }

  // -d first (safe), escalate to -D only with explicit --force.
  const deleteResult = Bun.spawnSync(["git", "-C", config.repoRoot, "branch", "-d", branch], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (deleteResult.exitCode !== 0) {
    if (!force) {
      log("error", `branch -d refused for '${branch}': ${deleteResult.stderr.toString().trim()}`);
      raw("  Re-run with --force to delete anyway.");
      process.exit(1);
    }
    gitRun(config.repoRoot, "branch", "-D", branch);
  }
  log("success", `deleted branch '${branch}' (tip ${sha} recoverable from reflog)`);
}
