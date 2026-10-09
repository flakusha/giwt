// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Lazy dev-checkout sync after the staging merge. The dev checkout never
 * participates in the merge itself: it is fast-forwarded afterwards only
 * when a pre-CAS snapshot proves it clean and on-target. Never stashes,
 * never resets user state.
 */

import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";
import { LOCK_FILENAME } from "../abort/helpers";
import { spawnGit } from "./staging-tree";

/**
 * Dev-checkout sync eligibility, snapshotted BEFORE the target ref moves:
 * after the CAS the status legitimately shows staged deletions of the newly
 * merged files, so the decision must not sample post-move state. giwt's own
 * lock scratch (the lockfile is gitignored; the FIFO queue dir is not) is
 * exempt — same exemption abort.ts makes.
 */
const DEV_SCRATCH_LINES = new Set([
  `?? ${LOCK_FILENAME}`,
  `?? ${LOCK_FILENAME}.queue/`,
]);

export interface DevReadiness {
  /**
   * dev's symbolic HEAD IS the target branch. Only then does the CAS ref move
   * drag dev's HEAD along and strand its index against the new commit
   * (BUG-finalize-leaves-dev-worktree-stale-after-merging). Detached or on
   * another branch, the index still describes dev's own HEAD and is inert.
   */
  onTargetBranch: boolean;
  /** Index + working tree matched old HEAD at snapshot time (pre-CAS). */
  clean: boolean;
  /** Why the checkout is not ready ("" when ready). */
  reason: string;
}

export function snapshotDevReadiness(
  config: WorktreeConfig,
  targetBranch: string,
): DevReadiness {
  const head = spawnGit(["symbolic-ref", "--short", "HEAD"], config.repoRoot);
  const currentBranch = head.stdout.trim();
  if (head.exitCode !== 0 || currentBranch !== targetBranch) {
    const where = head.exitCode === 0 ? `'${currentBranch}'` : "detached HEAD";
    return { onTargetBranch: false, clean: false, reason: `on ${where}` };
  }
  const status = spawnGit(["status", "--porcelain"], config.repoRoot);
  const dirtyLines = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !DEV_SCRATCH_LINES.has(line));
  if (dirtyLines.length > 0) {
    return { onTargetBranch: true, clean: false, reason: "dirty working tree" };
  }
  return { onTargetBranch: true, clean: true, reason: "" };
}

/**
 * Realign a stranded dev index with the moved ref.
 *
 * When dev's HEAD IS the target branch, the CAS moves HEAD out from under the
 * index: `git status` then reports every merge-landed path as a STAGED
 * DELETION, and a routine `git commit` on the dev checkout would delete code
 * the merge had just landed (BUG-finalize-leaves-dev-worktree-stale-after-
 * merging). `reset --mixed HEAD` rewrites the index to the new commit and
 * leaves the working tree untouched — index-only, zero bytes on disk.
 *
 * Scope of what is preserved, stated precisely: working-tree CONTENT is never
 * touched, so nothing the operator wrote can be lost. What reset does discard
 * is the staged-vs-unstaged distinction — content the operator had already
 * staged comes back as unstaged, and files the merge landed but dev lacks stay
 * absent from disk as unstaged deletions. That is the deliberate trade: the
 * alternative is those same paths sitting STAGED, where an ordinary commit
 * deletes committed code. Unstaged deletions are visible in `git status` and
 * recoverable with `git checkout HEAD -- <paths>`; staged deletions are a trap.
 *
 * Only reached for a checkout proven dirty pre-CAS, so the clean fast-forward
 * path above is unchanged.
 */
function realignStrandedIndex({ config, targetBranch }: {
  config: WorktreeConfig;
  targetBranch: string;
}): boolean {
  const rs = spawnGit(["reset", "--mixed", "HEAD"], config.repoRoot);
  if (rs.exitCode !== 0) {
    log("warn", `dev checkout index realign failed — the staged deletions below may persist`);
    raw(`  Stderr: ${rs.stderr.trim()}`);
    return false;
  }
  log("success", `dev checkout index realigned to ${targetBranch} (working tree preserved)`);
  return true;
}

/**
 * Lazy sync using a pre-CAS readiness snapshot. Returns true when the dev
 * checkout was clean and on the target branch and has been synced to the
 * moved ref.
 */
export function syncDevLazily(
  config: WorktreeConfig,
  targetBranch: string,
  readiness: DevReadiness,
): boolean {
  if (!readiness.clean || !readiness.onTargetBranch) {
    if (readiness.onTargetBranch) {
      // Dirty but ON the target branch: HEAD moved, the index did not. Leaving
      // it as-is stages the merge's own files as deletions — realign the index
      // so a routine commit cannot destroy what we just landed.
      realignStrandedIndex({ config, targetBranch });
    }
    log(
      "warn",
      `dev checkout not fast-forwarded to ${targetBranch} (${readiness.reason}) — sync manually`,
    );
    raw(`  Then: git -C ${config.repoRoot} merge --ff-only ${targetBranch}`);
    return false;
  }
  // The ref already moved under dev (symbolic HEAD == target), so
  // `merge --ff-only` would no-op as "up to date" while the worktree lags.
  // A forced checkout to the ref is provably lossless here: the pre-CAS
  // snapshot verified index+worktree == old HEAD, so the only delta is the
  // merge itself. This is NOT the unscoped `reset --hard` the abort path
  // bans — that fires on UNKNOWN user dirt; this fires only on a verified
  // clean pre-state.
  const co = spawnGit(["checkout", "-q", "-f", targetBranch], config.repoRoot);
  if (co.exitCode !== 0) {
    log("warn", `dev checkout sync to ${targetBranch} failed — sync manually`);
    raw(`  Stderr: ${co.stderr.trim()}`);
    return false;
  }
  log("success", `dev checkout synced to ${targetBranch}`);
  return true;
}
