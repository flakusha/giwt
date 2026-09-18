// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Worktree-registry reconciliation helpers.
 *
 * git's worktree registry (.git/worktrees/*) drifts from reality when a
 * worktree directory is deleted behind git's back or a branch ref is
 * force-removed: `git worktree list` keeps reporting the dead entry
 * (`prunable gitdir file points to non-existent location`), `git worktree
 * add` refuses the path ("missing but already registered worktree"), and a
 * naive "is there a worktree" directory check misses the registration
 * entirely. Ticket FIX-stale-worktree-registry.
 *
 * Verified against git 2.55 porcelain behavior:
 * - dir deleted, ref intact  -> HEAD + branch survive, entry marked prunable
 * - dir + ref deleted        -> HEAD reads as all-zeros (dangling branch
 *                               symref) or stays a real sha (detached
 *                               registration)
 * - `git worktree prune`     -> drops exactly the dir-missing registrations
 */

import { existsSync, readdirSync } from "fs";
import { resolve } from "path";
import { getWorktrees, gitSync, type GitWorktree } from "../utils/git";

export interface StaleReasons {
  /** Registration exists but the worktree directory is gone (prunable). */
  dirMissing: boolean;
  /** Registration names a branch whose ref no longer exists. */
  refMissing: boolean;
}

/**
 * A registered worktree has a real checkout when its .git pointer file
 * exists — mirrors git's own prune criterion (gitdir back-pointer).
 * Three commands must agree on this definition, hence the named seam.
 */
export function hasWorktreeDir(wtPath: string): boolean {
  return existsSync(resolve(wtPath, ".git"));
}

/** True when the directory exists and holds no entries (leftover husk). */
export function isDirEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

/** Path-normalized lookup of a worktree registration for `wtPath`. */
export function findRegistration(
  worktrees: readonly GitWorktree[],
  wtPath: string,
): GitWorktree | undefined {
  const want = resolve(wtPath);
  return worktrees.find((wt) => resolve(wt.path) === want);
}

/** Registration for `wtPath` according to `git worktree list`, if any. */
export async function registrationFor(
  repoRoot: string,
  wtPath: string,
): Promise<GitWorktree | undefined> {
  return findRegistration(await getWorktrees(repoRoot), wtPath);
}

/** Check one registration against reality: directory on disk + branch ref. */
export function staleReasons(repoRoot: string, wt: GitWorktree): StaleReasons {
  const dirMissing = !hasWorktreeDir(wt.path);
  let refMissing = false;
  if (wt.branch) {
    try {
      gitSync(repoRoot, "rev-parse", "--verify", "--quiet", wt.branch);
    } catch {
      refMissing = true;
    }
  }
  return { dirMissing, refMissing };
}

/** Drop registrations whose worktree directory vanished (git's own rule). */
export function pruneStaleRegistrations(repoRoot: string): void {
  gitSync(repoRoot, "worktree", "prune");
}

/**
 * Last-known commit of a stale registration, or null when it reads as
 * all-zeros — a dangling branch symref carries no recoverable commit.
 */
export function recoverableHead(wt: GitWorktree): string | null {
  if (!wt.HEAD || /^0+$/.test(wt.HEAD)) return null;
  return wt.HEAD;
}
