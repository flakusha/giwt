// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Step 5 merge inside an ephemeral staging worktree (FEAT-merge-in-staging-
 * worktree-with-ref-move).
 *
 * The dev checkout never sees a merge: the branch tip is rebased onto the
 * target inside a detached staging worktree under tree/.finalize-<branch>-
 * <pid>, the integration commit (if any) is built there, and the target ref
 * moves with a single atomic `git update-ref <ref> <new> <old>` — a
 * concurrent mover fails the CAS instead of corrupting the branch (update-ref
 * is policy-allowed; the delete blocker only fires on -d/--delete). The dev
 * checkout then syncs lazily (staging-sync.ts); worktree plumbing lives in
 * staging-tree.ts.
 */

import { rebaseWithPlanReconciliation } from "../../plan/reconcile-conflicts";
import { assertGitAuthorIdentity } from "../../utils/author-guard";
import type { WorktreeConfig } from "../../utils/config";
import { gitSync } from "../../utils/git";
import { assertAgentGpgUnlocked } from "../../utils/gpg";
import { log, raw } from "../../utils/output";
import { scopedSignFlags } from "../scoped-reconcile";
import { directMergeInStaging, squashInStaging } from "./staging-strategy";
import { type DevSyncResult, snapshotDevReadiness, syncDevLazily } from "./staging-sync";
import { pruneStagingWorktrees, removeStaging, spawnGit, stagingDirFor } from "./staging-tree";
import { publishActiveStagingTeardown } from "./state";

export interface StagingMergeResult {
  /** Post-merge SHA of refs/heads/<targetBranch> (the CAS-moved ref). */
  targetSha: string;
  /** Lazy dev-sync outcome after the CAS (see staging-sync.ts). */
  devSync: DevSyncResult;
}

/**
 * Step 5: integrate `branch` into `targetBranch` inside the staging
 * worktree. Returns null when the target already contains the branch
 * (`alreadyMerged`) — teardown still runs, nothing is merged or moved.
 */
export function executeStagingMerge(
  branch: string,
  mergeStrategy: string,
  force: boolean,
  config: WorktreeConfig,
  targetBranch: string,
  alreadyMerged: boolean,
  args: string[],
): StagingMergeResult | null {
  if (alreadyMerged) return null;

  // Fail-fast preflight before any staging directory exists. Warn order
  // matches the old flow: the strategy warning precedes the --force refusal.
  if (mergeStrategy === "direct") {
    log(
      "warn",
      `Direct merge strategy: conflicts will be resolved on ${targetBranch} — this can leave ${targetBranch} in a broken state. Consider --merge-strategy rebase.`,
    );
    if (!force) {
      log("error", "Aborted. Use --force to proceed with direct merge");
      process.exit(1);
    }
  }
  if (mergeStrategy !== "rebase") {
    // Gate: GPG must be configured AND unlocked before we produce a squash
    // or merge commit (cold cache previously produced unsigned commits).
    assertAgentGpgUnlocked();
  }

  pruneStagingWorktrees(config, branch);
  const stagingDir = stagingDirFor(config, branch);
  const oldSha = gitSync(config.repoRoot, "rev-parse", `refs/heads/${targetBranch}`);

  const add = spawnGit(
    ["worktree", "add", "--quiet", "--detach", stagingDir, branch],
    config.repoRoot,
  );
  if (add.exitCode !== 0) {
    log("error", `failed to create staging worktree at ${stagingDir}`);
    raw(`  Stderr: ${add.stderr.trim()}`);
    process.exit(1);
  }

  // Any process.exit from here on (guard refusal below, rebase conflict,
  // CAS refusal, failed verify) must not leak the staging worktree —
  // publish the teardown BEFORE the guard so the guard's own exit is
  // covered (state.ts releaseActiveStagingTeardown, same pattern as the
  // lock release).
  publishActiveStagingTeardown(() => removeStaging(config, stagingDir));
  // Guard: the staging worktree inherits the repo's git config, and every
  // commit this merge produces (rebase replay, squash, direct) is authored
  // from that identity. Checked BEFORE any mutation so a refusal leaves no
  // merge state behind. One guard here covers all three strategies — a
  // per-site guard inside squashInStaging/directMergeInStaging would miss
  // the rebase path.
  assertGitAuthorIdentity({
    cwd: stagingDir,
    expectedEmail: config.agentGpgEmail ?? "",
    args,
    source: mergeStrategy === "rebase"
      ? "rebase"
      : mergeStrategy === "squash"
      ? "squash merge"
      : "merge",
  });

  // Step 5a: rebase the branch tip onto the target inside staging — for the
  // rebase and squash strategies only, matching the old in-dev flow (direct
  // merges the raw branch tip so its conflicts stay resolvable). The dev
  // checkout is never touched; the branch ref itself does not move (staging
  // is detached), so a failed attempt leaves nothing to clean up in dev.
  if (mergeStrategy !== "direct") {
    log("info", `Step 5a: Rebasing '${branch}' onto ${targetBranch} (staging: ${stagingDir})...`);
    const rebaseResult = rebaseWithPlanReconciliation(
      stagingDir,
      targetBranch,
      config.settings.paths.planDir,
      config.settings.paths.tickets,
      scopedSignFlags(config.agentGpgKeyId),
    );
    if (rebaseResult.exitCode !== 0) {
      if (rebaseResult.output.trim()) raw(rebaseResult.output.trimEnd());
      log("error", `Rebase conflicts — resolve in the staging worktree ${stagingDir}`);
      raw(`  Then: cd ${stagingDir} && git rebase --continue`);
      raw(`  Then: finalize again`);
      raw(`  Or:   git worktree remove --force ${stagingDir}`);
      process.exit(1);
    }
    log("success", "Rebased successfully");
  }
  const newTip = gitSync(stagingDir, "rev-parse", "HEAD");
  // Dev readiness must be snapshotted pre-CAS (see staging-sync.ts).
  const readiness = snapshotDevReadiness(config, targetBranch);
  let finalSha = newTip;
  if (mergeStrategy === "squash") {
    finalSha = squashInStaging(branch, config, stagingDir, targetBranch, newTip);
  } else if (mergeStrategy === "direct") {
    finalSha = directMergeInStaging(branch, config, stagingDir, targetBranch, newTip);
  }

  // Atomic CAS move of the target ref: a concurrent mover between our
  // oldSha snapshot and now fails the update instead of corrupting the ref.
  const cas = spawnGit(
    ["update-ref", `refs/heads/${targetBranch}`, finalSha, oldSha],
    config.repoRoot,
  );
  if (cas.exitCode !== 0) {
    removeStaging(config, stagingDir);
    log(
      "error",
      `target '${targetBranch}' moved concurrently (expected ${
        oldSha.slice(0, 8)
      }) — CAS refused, nothing merged`,
    );
    raw(`  Then: re-run finalize to rebase onto the moved target`);
    process.exit(1);
  }
  log("success", `${targetBranch} moved to ${finalSha.slice(0, 8)}`);

  const devSync = syncDevLazily(config, targetBranch, readiness);
  removeStaging(config, stagingDir);
  publishActiveStagingTeardown(null);
  return { targetSha: finalSha, devSync };
}
