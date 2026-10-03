// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import { basename } from "path";
import { isolatedGitEnv } from "../../utils/git";
import { log, raw } from "../../utils/output";

/**
 * Step 1 of finalize: refuse to run against a worktree with uncommitted or
 * untracked changes — `worktree remove --force` would silently discard them.
 * Returns true when the worktree directory is missing entirely (external
 * removal between dispatch and Step 1); the caller then skips content
 * checks and lets teardown prune the stale registration.
 */
export function ensureWorktreeClean(wtPath: string): boolean {
  log("info", "Step 1: Checking worktree state...");
  // The worktree dir can vanish between dispatch and Step 1 (external
  // `git worktree remove`, a crash-cleanup race). The git probes below would
  // all fail with "cannot change to ..." and read as "dirty"; treat a
  // missing dir as clean and let teardown prune + delete the branch.
  if (!existsSync(wtPath)) {
    log("info", "Worktree missing — skipping clean-state checks");
    return true;
  }
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
    log("error", "uncommitted changes detected — commit or stash before finalizing");
    raw(`  cd ${wtPath} && git add -A && git commit -m 'feat: ...'`);
    raw(`  cd ${wtPath} && git stash`);
    process.exit(1);
  }
  // Untracked files are invisible to `git diff` but `worktree remove
  // --force` deletes them all the same — probe them explicitly so
  // finalize never silently discards data (same probe as stashDevForMerge).
  // Lockfiles are exempt: the bun.lock that enables the gate steps is
  // commonly untracked in a fresh worktree and is regenerable, not data.
  const untracked = Bun.spawnSync(
    ["git", "-C", wtPath, "ls-files", "--others", "--exclude-standard"],
    { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
  );
  const LOCKFILE_NAMES: Record<string, true> = { "bun.lock": true, "bun.lockb": true };
  const untrackedFiles = untracked.stdout.toString().trim().split("\n")
    .filter((file) => file.length > 0 && !LOCKFILE_NAMES[basename(file)]);
  if (untrackedFiles.length > 0) {
    log("error", "untracked files detected — commit or remove before finalizing");
    for (const file of untrackedFiles) {
      raw(`  ${file}`);
    }
    raw(`  cd ${wtPath} && git add -A && git commit -m 'feat: ...'`);
    raw(`  cd ${wtPath} && git stash`);
    process.exit(1);
  }
  log("success", "Worktree clean");
  return false;
}
