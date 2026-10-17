// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Linked-worktree probe. A linked worktree (git-dir ≠ git-common-dir) is
 * where per-branch state must not be written — index.json is regenerated
 * post-merge on the target branch instead (461e906).
 */

import { isolatedGitEnv } from "./git";

/** True when `root` is a linked worktree rather than the main checkout.
 *  An unreadable probe (e.g. git missing entirely) is treated as the main
 *  checkout: callers either fail later on their own git reads, or are
 *  fix-mode runs that `runSync` already refuses before persisting. */
export function isLinkedWorktree(root: string): boolean {
  try {
    const probe = Bun.spawnSync(
      ["git", "-C", root, "rev-parse", "--git-dir", "--git-common-dir"],
      { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
    );
    const dirs = probe.exitCode === 0 ? probe.stdout.toString().trim().split("\n") : [];
    return dirs.length === 2 && dirs[0] !== dirs[1];
  } catch {
    return false;
  }
}
