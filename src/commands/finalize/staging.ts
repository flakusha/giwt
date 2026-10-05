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

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebaseWithPlanReconciliation } from "../../plan/reconcile-conflicts";
import { loadAllowedTrailers, squashMessageWithCoAuthors } from "../../utils/coauthors";
import type { WorktreeConfig } from "../../utils/config";
import { assertAuthorMatchesCommitter } from "../../utils/author-guard";
import { gitSync, gitSyncQuiet } from "../../utils/git";
import { assertAgentGpgUnlocked } from "../../utils/gpg";
import { log, raw } from "../../utils/output";
import { scopedSignFlags } from "../scoped-worktree";
import { branchToSquashMessage, gpgMergeFlags } from "./merge";
import { snapshotDevReadiness, syncDevLazily } from "./staging-sync";
import {
  checkoutTargetInStaging,
  pruneStagingWorktrees,
  removeStaging,
  spawnGit,
  stagingDirFor,
} from "./staging-tree";
import { setMergeInProgress } from "./state";

export interface StagingMergeResult {
  /** Post-merge SHA of refs/heads/<targetBranch> (the CAS-moved ref). */
  targetSha: string;
  /** True when the dev checkout was clean, on-target, and fast-forwarded. */
  devSynced: boolean;
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
    finalSha = squashInStaging(branch, config, stagingDir, targetBranch, newTip, args);
  } else if (mergeStrategy === "direct") {
    finalSha = directMergeInStaging(branch, config, stagingDir, targetBranch, newTip, args);
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

  const devSynced = syncDevLazily(config, targetBranch, readiness);
  removeStaging(config, stagingDir);
  return { targetSha: finalSha, devSynced };
}

function squashInStaging(
  branch: string,
  config: WorktreeConfig,
  stagingDir: string,
  targetBranch: string,
  newTip: string,
  args: string[],
): string {
  // Real co-authors on the squashed commits survive the squash: the
  // conventional subject gains their deduplicated Co-Authored-By trailers
  // (LLM-vendor ones dropped by the shared policy).
  const baseMsg = branchToSquashMessage(branch);
  const msg = squashMessageWithCoAuthors(
    config.repoRoot,
    baseMsg,
    `${targetBranch}..${branch}`,
    loadAllowedTrailers(config.repoRoot),
  );
  log("info", `Step 5b: Squash merging into ${targetBranch} (staging)...`);
  checkoutTargetInStaging(stagingDir, targetBranch);
  const flags = gpgMergeFlags(config);
  const preHead = gitSyncQuiet(stagingDir, "rev-parse", "HEAD");
  setMergeInProgress(stagingDir, branch, preHead, null, true);
  const mergeResult = spawnGit(
    [...flags, "merge", newTip, "--squash", "-m", msg],
    stagingDir,
  );
  if (mergeResult.exitCode !== 0) {
    log("error", "Squash merge failed");
    removeStaging(config, stagingDir);
    process.exit(1);
  }
  // `git merge --squash` stages but never commits (its -m is ignored on the
  // ff path) — produce the squash commit now, signed via the same
  // gpgMergeFlags, with the co-author-aware message.
  const msgFile = join(config.repoRoot, ".git", "GIWT_SQUASH_MSG");
  writeFileSync(msgFile, `${msg}\n`);

  // Guard: refuse to commit when the staging worktree's author does not match
  // the maintainer identity. The staging worktree inherits the repo's git config;
  // GPG signing validates the committer, not the author.
  const authorEmail = gitSyncQuiet(stagingDir, "config", "user.email");
  if (authorEmail) {
    assertAuthorMatchesCommitter({
      authorEmail,
      expectedEmail: config.agentGpgEmail ?? "",
      args,
      source: "squash merge",
    });
  }
  const squashCommit = spawnGit([...flags, "commit", "-F", msgFile], stagingDir);

  try {
    unlinkSync(msgFile);
  } catch { /* best-effort scratch cleanup */ }
  if (squashCommit.exitCode !== 0) {
    log("error", "Squash commit failed");
    removeStaging(config, stagingDir);
    raw(`  Nothing was merged — the target ref is untouched; re-run finalize to retry`);
    process.exit(1);
  }
  setMergeInProgress(stagingDir, branch, preHead, null, false);
  log("success", `Squash merged: ${baseMsg}`);
  return gitSync(stagingDir, "rev-parse", "HEAD");
}

function directMergeInStaging(
  branch: string,
  config: WorktreeConfig,
  stagingDir: string,
  targetBranch: string,
  newTip: string,
  args: string[],
): string {
  log("info", `Step 5b: Direct merging into ${targetBranch} (staging)...`);
  checkoutTargetInStaging(stagingDir, targetBranch);
  const flags = gpgMergeFlags(config);
  const preHead = gitSyncQuiet(stagingDir, "rev-parse", "HEAD");
  setMergeInProgress(stagingDir, branch, preHead, null, true);

  // Guard: refuse to merge when the staging worktree's author does not match
  // the maintainer identity. The staging worktree inherits the repo's git config;
  // GPG signing validates the committer, not the author.
  const authorEmail = gitSyncQuiet(stagingDir, "config", "user.email");
  if (authorEmail) {
    assertAuthorMatchesCommitter({
      authorEmail,
      expectedEmail: config.agentGpgEmail ?? "",
      args,
      source: "merge",
    });
  }
  const mergeResult = spawnGit(
    [
      ...flags,
      "merge",
      newTip,
      "--no-edit",
      // Direct merge's contract is a GPG-signed merge commit; FF would skip
      // merge-commit creation and move verify-commit onto the branch tip.
      "--no-ff",
    ],
    stagingDir,
  );
  setMergeInProgress(stagingDir, branch, preHead, null, false);
  if (mergeResult.exitCode !== 0) {
    // Abandon: abort the merge and discard staging. The branch is intact,
    // the target ref untouched, and dev was never involved — nothing to
    // clean up anywhere (the old in-dev flow left dev mid-merge instead).
    spawnGit(["merge", "--abort"], stagingDir);
    removeStaging(config, stagingDir);
    log("error", `Direct merge conflicts — staging discarded, ${targetBranch} untouched`);
    raw(`  Then: re-run with --merge-strategy rebase to resolve conflicts incrementally`);
    process.exit(1);
  }
  const mergeSha = gitSync(stagingDir, "rev-parse", "HEAD");
  // Strict verify: assertAgentGpgUnlocked already gated against cold cache.
  // An unsigned merge here means the gate was bypassed (e.g. passphrase
  // expired mid-merge) — fail loudly BEFORE the CAS moves the ref.
  const verifyResult = spawnGit(["verify-commit", mergeSha], stagingDir);
  if (verifyResult.exitCode !== 0) {
    removeStaging(config, stagingDir);
    log("error", `Merge commit ${mergeSha.slice(0, 8)} is unsigned — refusing to finalize`);
    process.exit(1);
  }
  log("success", `Merge commit GPG-signed (${mergeSha.slice(0, 8)})`);
  return mergeSha;
}
