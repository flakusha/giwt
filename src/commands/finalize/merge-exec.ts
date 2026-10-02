// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { rebaseWithPlanReconciliation } from "../../plan/reconcile-conflicts";
import type { WorktreeConfig } from "../../utils/config";
import { gitSync, gitSyncQuiet, isolatedGitEnv } from "../../utils/git";
import { assertAgentGpgUnlocked } from "../../utils/gpg";
import { log, raw } from "../../utils/output";
import {
  branchToSquashMessage,
  gpgMergeFlags,
  restoreDevFromStash,
  stashDevForMerge,
} from "./merge";
import { setMergeInProgress } from "./state";

/**
 * Step 5: merge the finalized branch into the target, per --merge-strategy.
 * Skipped entirely when the target already contains HEAD. Rebase/squash
 * reconcile generated-plan conflicts; direct merges require --force and a
 * verified GPG signature. Every path stashes the dirty dev checkout around
 * the in-place merge and restores it in a finally.
 */
export function executeMergeStep(
  branch: string,
  mergeStrategy: string,
  force: boolean,
  config: WorktreeConfig,
  wtPath: string,
  targetBranch: string,
  alreadyMerged: boolean,
): void {
  // Step 5: Merge (skipped entirely when the target already contains HEAD)
  if (!alreadyMerged && (mergeStrategy === "rebase" || mergeStrategy === "squash")) {
    // 5a: Rebase
    log("info", `Step 5a: Rebasing '${branch}' onto ${targetBranch}...`);
    const rebaseResult = rebaseWithPlanReconciliation(
      wtPath,
      targetBranch,
      config.settings.paths.planDir,
      config.settings.paths.tickets,
    );
    if (rebaseResult.exitCode !== 0) {
      if (rebaseResult.output.trim()) raw(rebaseResult.output.trimEnd());
      log("error", `Rebase conflicts — resolve in ${wtPath}`);
      raw(`  Then: cd ${wtPath} && git rebase --continue`);
      raw(`  Then: finalize again`);
      raw(`  Or:   cd ${wtPath} && git rebase --abort`);
      process.exit(1);
    }
    log("success", "Rebased successfully");

    // 5b: Integrate
    if (mergeStrategy === "squash") {
      const msg = branchToSquashMessage(branch);
      log("info", `Step 5b: Squash merging into ${targetBranch}...`);
      // Gate: GPG must be configured AND unlocked before we produce a
      // squash commit. The previous `git merge --squash` invocation ran
      // without `-c commit.gpgsign=true`, producing an unsigned squash
      // commit even on a warm cache. Splicing gpgMergeFlags into the
      // command fixes that.
      assertAgentGpgUnlocked();
      const flags = gpgMergeFlags(config);
      const devStash = stashDevForMerge(config.repoRoot);
      const preMergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
      setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, true);
      try {
        const mergeResult = Bun.spawnSync([
          "git",
          "-C",
          config.repoRoot,
          ...flags,
          "merge",
          branch,
          "--squash",
          "-m",
          msg,
        ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
        if (mergeResult.exitCode !== 0) {
          log("error", "Squash merge failed");
          process.exit(1);
        }
        setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, false);
        log("success", `Squash merged: ${msg}`);
      } finally {
        if (devStash !== null) {
          const mergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
          restoreDevFromStash(config.repoRoot, devStash, mergeHead);
        }
      }
    } else {
      log("info", `Step 5b: Fast-forward merging into ${targetBranch}...`);
      const devStash = stashDevForMerge(config.repoRoot);
      let ffOk = false;
      const preMergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
      setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, true);
      try {
        const mergeResult = Bun.spawnSync([
          "git",
          "-C",
          config.repoRoot,
          "merge",
          branch,
          "--ff-only",
        ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
        if (mergeResult.exitCode !== 0) {
          log("error", "Fast-forward merge failed");
          process.exit(1);
        }
        ffOk = true;
        setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, false);
        log("success", "Fast-forward merged");
      } finally {
        if (devStash !== null) {
          const mergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
          restoreDevFromStash(config.repoRoot, devStash, mergeHead);
        }
      }
      if (ffOk) { /* restored above */ }
    }
  } else if (!alreadyMerged && mergeStrategy === "direct") {
    // Direct merge warning — logger channel: the old hand-drawn box was
    // decorative output leaked onto the raw data channel.
    log(
      "warn",
      `Direct merge strategy: conflicts will be resolved on ${targetBranch} — this can leave ${targetBranch} in a broken state. Consider --merge-strategy rebase.`,
    );

    if (!force) {
      log("error", "Aborted. Use --force to proceed with direct merge");
      process.exit(1);
    }
    // Gate: GPG must be configured AND unlocked before we attempt a signed
    // direct merge. The previous behavior let `gpgMergeFlags()` silently
    // return [] on cold cache, producing an unsigned merge commit.
    assertAgentGpgUnlocked();
    const flags = gpgMergeFlags(config);
    const devStash = stashDevForMerge(config.repoRoot);
    const preMergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
    setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, true);
    try {
      const mergeResult = Bun.spawnSync([
        "git",
        "-C",
        config.repoRoot,
        ...flags,
        "merge",
        branch,
        "--no-edit",
      ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
      if (mergeResult.exitCode !== 0) {
        log("error", `Merge conflicts — resolve on ${targetBranch}`);
        process.exit(1);
      }
      setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, false);
      log("success", `Merged into ${targetBranch}`);
    } finally {
      if (devStash !== null) {
        const mergeHead = gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD");
        restoreDevFromStash(config.repoRoot, devStash, mergeHead);
      }
    }

    // Verify GPG signature
    const mergeSha = gitSync(config.repoRoot, "rev-parse", "HEAD");
    const verifyResult = Bun.spawnSync(["git", "-C", config.repoRoot, "verify-commit", mergeSha], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    // Strict verify: assertAgentGpgUnlocked above already gates against
    // cold-cache. An unsigned merge here means the cold-cache gate was
    // bypassed (e.g. passphrase expired mid-merge) — fail loudly rather
    // than silently leaving an unsigned commit on the target branch.
    if (verifyResult.exitCode === 0) {
      log("success", `Merge commit GPG-signed (${mergeSha.slice(0, 8)})`);
    } else {
      log("error", `Merge commit ${mergeSha.slice(0, 8)} is unsigned — refusing to finalize`);
      process.exit(1);
    }
  }
}
