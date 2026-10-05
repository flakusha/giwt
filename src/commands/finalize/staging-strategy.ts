// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Step 5b merge strategies executed inside the ephemeral staging worktree:
 * squash (merge --squash + signed squash commit) and direct (--no-ff merge
 * commit, strictly verified). Called from executeStagingMerge (staging.ts)
 * after the author-identity guard and teardown publication are in place.
 */

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllowedTrailers, squashMessageWithCoAuthors } from "../../utils/coauthors";
import type { WorktreeConfig } from "../../utils/config";
import { gitSync, gitSyncQuiet } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { branchToSquashMessage, gpgMergeFlags } from "./merge";
import { checkoutTargetInStaging, removeStaging, spawnGit } from "./staging-tree";
import { setMergeInProgress } from "./state";

export function squashInStaging(
  branch: string,
  config: WorktreeConfig,
  stagingDir: string,
  targetBranch: string,
  newTip: string,
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
  // gpgMergeFlags, with the co-author-aware message. The msg file lives
  // inside the staging worktree so removeStaging (incl. the published
  // exit-hook teardown) always cleans it — a leaked scratch file cannot
  // outlive the merge attempt.
  const msgFile = join(stagingDir, "GIWT_SQUASH_MSG");
  writeFileSync(msgFile, `${msg}\n`);
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

export function directMergeInStaging(
  branch: string,
  config: WorktreeConfig,
  stagingDir: string,
  targetBranch: string,
  newTip: string,
): string {
  log("info", `Step 5b: Direct merging into ${targetBranch} (staging)...`);
  checkoutTargetInStaging(stagingDir, targetBranch);
  const flags = gpgMergeFlags(config);
  const preHead = gitSyncQuiet(stagingDir, "rev-parse", "HEAD");
  setMergeInProgress(stagingDir, branch, preHead, null, true);
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
