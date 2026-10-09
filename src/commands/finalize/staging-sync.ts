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
import { activeRun } from "../../utils/runlog";
import { setLastFailedGates } from "./checks";
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
  // Worktree presence is probed independently of status: a corrupt index
  // makes `git status` fail while the checkout is still perfectly real —
  // "status failed" must never masquerade as "no working tree".
  const probe = spawnGit(["rev-parse", "--is-inside-work-tree"], config.repoRoot);
  const worktree = probe.exitCode === 0 && probe.stdout.trim() === "true";
  const paths = readDevStatus(config);
  const statusRead = paths !== null;
  const dirtyPaths = new Set(statusRead ? paths : []);
  const base: DevReadiness = {
    onTarget: false,
    reason: "",
    headBranch: currentBranch,
    headSha,
    worktree,
    statusRead,
    dirtyPaths,
  };
  if (head.exitCode !== 0 || currentBranch !== targetBranch) {
    const where = head.exitCode === 0 ? `'${currentBranch}'` : "detached HEAD";
    return { ...base, reason: `on ${where}` };
  }
  if (!worktree) return { ...base, reason: "no working tree" };
  if (!statusRead) return { ...base, reason: "dev status unavailable" };
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
  if (!readiness.statusRead) {
    // Dev sits on the target but its pre-CAS status could not be read: the
    // safety proof for a post-move restore is unavailable — fail closed so
    // the caller refuses instead of continuing over an unverifiable state.
    log(
      "error",
      `cannot prove the dev checkout is safe against ${targetBranch} (dev status unavailable)`,
    );
    return { synced: false, blocked: true, reason: "dev status unavailable" };
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

/** Refusal message + run-record outcome for a dev checkout that carries
 *  genuine uncommitted work and cannot be synced to the moved ref. The
 *  caller still skips teardown and exits non-zero. */
export function refuseUnsyncedDev({
  config,
  targetBranch,
  reason,
  wtPath,
  branch,
}: {
  config: WorktreeConfig;
  targetBranch: string;
  reason: string;
  wtPath: string;
  branch: string;
}): void {
  // Outcome before exit: process.exit bypasses the dispatch catch, the exit
  // hook only backfills end/exitCode, never outcome data.
  setLastFailedGates(["dev-sync"]);
  activeRun()?.outcome({ failedGates: ["dev-sync"] });
  log("error", `dev checkout NOT synced to ${targetBranch} — ${reason}`);
  // Only the genuine-work refusal restores residue; when the safety proof
  // itself was unavailable (status/delta/HEAD) or the restore failed, the
  // checkout may still sit at the pre-move state — no false reassurance.
  if (reason.startsWith("uncommitted changes")) {
    raw("  Dev's uncommitted files are preserved untouched; merge residue was restored.");
  }
  raw(`  Teardown skipped: worktree ${wtPath} and branch '${branch}' are kept.`);
  raw(
    `  Then: commit or stash the changes in ${config.repoRoot}, then re-run 'giwt finalize ${branch}' to finish teardown`,
  );
  process.exit(1);
}
