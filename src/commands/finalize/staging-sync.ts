// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Lazy dev-checkout sync after the staging merge. The dev checkout never
 * participates in the merge itself: the target ref moves under it via CAS
 * and the checkout is synced afterwards — from a snapshot taken BEFORE the
 * move (never from post-move state, which the CAS itself perturbs).
 *
 * Post-move classification and the targeted residue restore live in
 * dev-restore.ts.
 */

import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";
import {
  type DevReadiness,
  type DevSyncResult,
  readDevStatus,
  restoreMovedDevCheckout,
} from "./dev-restore";
import { spawnGit } from "./staging-tree";

export type { DevReadiness, DevSyncResult } from "./dev-restore";

/**
 * Snapshot dev-checkout sync eligibility. MUST run before the CAS ref move:
 * `headSha` anchors the merge-delta classification and `dirtyPaths` marks
 * the paths that carry genuine user content.
 */
export function snapshotDevReadiness(
  config: WorktreeConfig,
  targetBranch: string,
): DevReadiness {
  const head = spawnGit(["symbolic-ref", "--short", "HEAD"], config.repoRoot);
  const currentBranch = head.exitCode === 0 ? head.stdout.trim() : "";
  const headSha = spawnGit(["rev-parse", "HEAD"], config.repoRoot).stdout.trim();
  const paths = readDevStatus(config);
  const worktree = paths !== null;
  const dirtyPaths = new Set(worktree ? paths : []);
  const base: DevReadiness = {
    onTarget: false,
    reason: "",
    headBranch: currentBranch,
    headSha,
    worktree,
    dirtyPaths,
  };
  if (head.exitCode !== 0 || currentBranch !== targetBranch) {
    const where = head.exitCode === 0 ? `'${currentBranch}'` : "detached HEAD";
    return { ...base, reason: `on ${where}` };
  }
  if (!worktree) return { ...base, reason: "no working tree" };
  if (dirtyPaths.size > 0) return { ...base, reason: "dirty working tree" };
  return { ...base, onTarget: true };
}

/**
 * Lazy sync using the pre-CAS readiness snapshot. Returns `synced` when the
 * dev checkout reflects the moved ref, and `blocked` when genuine
 * uncommitted work makes the sync impossible — the caller must refuse
 * instead of reporting success.
 */
export function syncDevLazily(
  config: WorktreeConfig,
  targetBranch: string,
  readiness: DevReadiness,
): DevSyncResult {
  // Re-verify the checkout still sits on the target branch: the snapshot is
  // pre-CAS, and a checkout that moved elsewhere mid-merge would classify
  // the wrong delta.
  const head = spawnGit(["symbolic-ref", "--short", "HEAD"], config.repoRoot);
  const stillOnTarget = head.exitCode === 0 && head.stdout.trim() === targetBranch;
  if (!readiness.worktree || !stillOnTarget) {
    // No usable checkout of the target: the ref move cannot have desynced
    // this checkout, so — like a missing dev checkout — this stays
    // informational and no residue can exist here.
    const why = !readiness.worktree
      ? readiness.reason
      : head.exitCode === 0
      ? `on '${head.stdout.trim()}'`
      : "on detached HEAD";
    log("warn", `dev checkout not fast-forwarded to ${targetBranch} (${why}) — sync manually`);
    raw(`  Then: git -C ${config.repoRoot} merge --ff-only ${targetBranch}`);
    return { synced: false, blocked: false, reason: why };
  }
  if (readiness.onTarget) {
    // The ref already moved under dev (symbolic HEAD == target), so
    // `merge --ff-only` would no-op as "up to date" while the worktree lags.
    // A forced checkout to the ref is provably lossless here: the pre-CAS
    // snapshot verified index+worktree == old HEAD, so the only delta is the
    // merge itself. This is NOT the unscoped `reset --hard` the abort path
    // bans — that fires on UNKNOWN user dirt; this fires only on a verified
    // clean pre-state.
    const co = spawnGit(["checkout", "-q", "-f", targetBranch], config.repoRoot);
    if (co.exitCode === 0) {
      log("success", `dev checkout synced to ${targetBranch}`);
      return { synced: true, blocked: false, reason: "" };
    }
    // Fall through to the targeted residue restore instead of failing open
    // with the checkout left stale against the moved ref.
    log("warn", `forced checkout failed — restoring merge paths from ${targetBranch}`);
  }
  return restoreMovedDevCheckout({ config, targetBranch, readiness });
}
