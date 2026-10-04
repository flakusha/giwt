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

export function snapshotDevReadiness(config: WorktreeConfig, targetBranch: string): {
  onTarget: boolean;
  reason: string;
} {
  const head = spawnGit(["symbolic-ref", "--short", "HEAD"], config.repoRoot);
  const currentBranch = head.stdout.trim();
  if (head.exitCode !== 0 || currentBranch !== targetBranch) {
    const where = head.exitCode === 0 ? `'${currentBranch}'` : "detached HEAD";
    return { onTarget: false, reason: `on ${where}` };
  }
  const status = spawnGit(["status", "--porcelain"], config.repoRoot);
  const dirtyLines = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !DEV_SCRATCH_LINES.has(line));
  if (dirtyLines.length > 0) return { onTarget: false, reason: "dirty working tree" };
  return { onTarget: true, reason: "" };
}

/**
 * Lazy sync using a pre-CAS readiness snapshot. Returns true when the dev
 * checkout was clean and on the target branch and has been synced to the
 * moved ref.
 */
export function syncDevLazily(
  config: WorktreeConfig,
  targetBranch: string,
  readiness: { onTarget: boolean; reason: string; },
): boolean {
  if (!readiness.onTarget) {
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
