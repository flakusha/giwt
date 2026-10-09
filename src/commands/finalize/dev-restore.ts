// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Post-move dev-checkout restore (the staging-sync seam). After the CAS
 * moved the target ref, every post-move dirty path in the dev checkout is
 * classified against the pre-CAS snapshot and the merge delta (snapshot
 * HEAD → moved ref):
 *   - merge residue — fully explained by the delta, worktree content still
 *     identical to the pre-move HEAD. Safe to restore from the moved HEAD.
 *   - genuine uncommitted work — anything else (dirty before the move, or
 *     unexplainable). NEVER touched; the sync refuses loudly instead
 *     (`blocked`), and finalize must not report success.
 *
 * The invariant: a path that was clean at the pre-move HEAD and is only
 * listed because HEAD moved away from it has no user content — its index
 * and worktree bytes are exactly the pre-move HEAD's bytes, so restoring
 * them from the moved ref loses nothing. Never stashes; never resets a
 * path that carries genuine user content.
 */

import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";
import { LOCK_FILENAME } from "../abort/helpers";
import { spawnGit } from "./staging-tree";

/** Delta actions the residue restore knows how to repair. */
type DeltaAction = "A" | "M" | "D";

/**
 * Dev-checkout sync eligibility, snapshotted BEFORE the target ref moves:
 * after the CAS the status legitimately shows staged deletions of the newly
 * merged files, so the decision must not sample post-move state.
 */
export interface DevReadiness {
  /** Clean AND on the target branch — the verified-lossless sync case. */
  onTarget: boolean;
  reason: string;
  /** symbolic-ref HEAD at snapshot time ("" when detached). */
  headBranch: string;
  /** Resolved HEAD sha at snapshot time ("" when unresolvable). */
  headSha: string;
  /** False when the checkout has no usable working tree (e.g. bare). */
  worktree: boolean;
  /**
   * True when the pre-move status read succeeded. False means the snapshot
   * could not sample dirty paths — the safety proof is unavailable and the
   * sync must fail closed, never treat the gap as benign.
   */
  statusRead: boolean;
  /** Pre-move dirty paths, giwt's own lock scratch excluded. */
  dirtyPaths: Set<string>;
}

export interface DevSyncResult {
  /** True when the dev checkout now reflects the moved ref. */
  synced: boolean;
  /**
   * True when genuine uncommitted work blocks the sync: finalize must not
   * report success (refuse with a non-zero exit) instead of warning and
   * continuing over a stale index.
   */
  blocked: boolean;
  reason: string;
}

/**
 * Dirty paths from `git status --porcelain -z -uall --no-renames` output.
 * -z is NUL-separated and never quotes paths, so path identity is stable
 * across the snapshot and the post-move classification. giwt's own lock
 * scratch (the lockfile is gitignored; the FIFO queue dir is not) is
 * exempt — same exemption abort.ts makes.
 */
function devDirtyPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const field of stdout.split("\0")) {
    if (field.length < 4) continue;
    const path = field.slice(3);
    const scratch = path === LOCK_FILENAME || path.startsWith(`${LOCK_FILENAME}.queue/`);
    if (!scratch) paths.push(path);
  }
  return paths;
}

/** Dirty dev paths (scratch-excluded), or null when status itself fails. */
export function readDevStatus(config: WorktreeConfig): string[] | null {
  const status = spawnGit(
    ["status", "--porcelain", "-z", "-uall", "--no-renames"],
    config.repoRoot,
  );
  return status.exitCode === 0 ? devDirtyPaths(status.stdout) : null;
}

/** Paths the merge delta touched (pre-move HEAD → moved ref), or null. */
function mergeDelta({ config, preHead, newHead }: {
  config: WorktreeConfig;
  preHead: string;
  newHead: string;
}): Map<string, DeltaAction> | null {
  const diff = spawnGit(
    ["diff", "--name-status", "--no-renames", "-z", preHead, newHead],
    config.repoRoot,
  );
  if (diff.exitCode !== 0) return null;
  const fields = diff.stdout.split("\0");
  const delta = new Map<string, DeltaAction>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const action = fields[i]!;
    const path = fields[i + 1]!;
    if (action === "" || path === "") continue;
    delta.set(path, action === "A" || action === "D" ? action : "M");
  }
  return delta;
}

/**
 * Post-move targeted restore: classify every post-move dirty path as merge
 * residue (fully explained by the merge delta) or genuine uncommitted work,
 * restore ONLY the residue from the moved HEAD, and report `blocked` when
 * genuine work keeps the checkout from syncing.
 */
export function restoreMovedDevCheckout({
  config,
  targetBranch,
  readiness,
}: {
  config: WorktreeConfig;
  targetBranch: string;
  readiness: DevReadiness;
}): DevSyncResult {
  const newHead = spawnGit(["rev-parse", `refs/heads/${targetBranch}`], config.repoRoot)
    .stdout.trim();
  const preHead = readiness.headSha;
  if (preHead === "" || newHead === "") {
    // Unresolvable pre-state: safety cannot be proven — refuse, never claim success.
    log(
      "error",
      `cannot prove the dev checkout is safe against ${targetBranch} (HEAD unresolvable)`,
    );
    return { synced: false, blocked: true, reason: "dev HEAD unresolvable" };
  }
  if (preHead === newHead) {
    // The ref did not move: the dirt is the user's own — nothing to repair or sync.
    return { synced: false, blocked: false, reason: "dev ref did not move" };
  }
  const delta = mergeDelta({ config, preHead, newHead });
  const postMove = readDevStatus(config);
  if (delta === null || postMove === null) {
    const why = delta === null ? "merge delta unavailable" : "dev status unavailable";
    log("error", `cannot prove the dev checkout is safe against ${targetBranch} (${why})`);
    return { synced: false, blocked: true, reason: why };
  }
  const genuine: string[] = [];
  const residue: Array<{ path: string; action: DeltaAction; }> = [];
  for (const path of postMove) {
    if (readiness.dirtyPaths.has(path)) {
      genuine.push(path);
      continue;
    }
    const action = delta.get(path);
    // A path neither pre-move dirty nor part of the merge delta cannot be
    // explained by the move — treat as user work.
    if (action === undefined) {
      genuine.push(path);
      continue;
    }
    // A delta path whose worktree content no longer matches the pre-move
    // HEAD was edited mid-merge — user work, never touched.
    const stillPreMove =
      spawnGit(["diff", "--quiet", preHead, "--", path], config.repoRoot).exitCode === 0;
    if (!stillPreMove) {
      genuine.push(path);
      continue;
    }
    residue.push({ path, action });
  }
  const repaired = restoreResidue(config, residue);
  if (genuine.length > 0) {
    const shown = genuine.slice(0, 5).map((p) => `'${p}'`).join(", ");
    const preview = genuine.length > 5 ? `${shown} … and ${genuine.length - 5} more` : shown;
    log(
      "warn",
      "dev checkout has uncommitted changes — merge residue restored, checkout NOT fast-forwarded",
    );
    raw(`  Uncommitted (preserved): ${preview}`);
    return {
      synced: false,
      blocked: true,
      reason: `uncommitted changes in the dev checkout: ${preview}`,
    };
  }
  if (!repaired) {
    return {
      synced: false,
      blocked: true,
      reason: "failed to restore merge residue in the dev checkout",
    };
  }
  const leftover = readDevStatus(config);
  if (leftover === null || leftover.length > 0) {
    return {
      synced: false,
      blocked: true,
      reason: "dev checkout still dirty after residue restore",
    };
  }
  log("success", `dev checkout synced to ${targetBranch}`);
  return { synced: true, blocked: false, reason: "" };
}

/**
 * Restore merge-residue paths from the moved HEAD. Scoped per path: the
 * classification proved each path's worktree bytes are exactly the pre-move
 * HEAD's bytes, so overwriting loses nothing. `git checkout HEAD -- <path>`
 * updates index + worktree for paths the merge added/modified; `git rm -f`
 * drops both for paths the merge deleted (-f is required post-CAS: against
 * the moved HEAD every such path reads as a staged add, which plain `git rm`
 * refuses — the proof above is what makes forcing it safe).
 */
function restoreResidue(
  config: WorktreeConfig,
  residue: Array<{ path: string; action: DeltaAction; }>,
): boolean {
  let ok = true;
  for (const { path, action } of residue) {
    const r = action === "D"
      ? spawnGit(["rm", "-q", "-f", "--", path], config.repoRoot)
      : spawnGit(["checkout", "HEAD", "--", path], config.repoRoot);
    if (r.exitCode !== 0) {
      log("warn", `could not restore '${path}' from HEAD (${r.stderr.trim()})`);
      ok = false;
    }
  }
  return ok;
}
