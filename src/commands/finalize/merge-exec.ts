// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebaseWithPlanReconciliation } from "../../plan/reconcile-conflicts";
import { loadAllowedTrailers, squashMessageWithCoAuthors } from "../../utils/coauthors";
import type { WorktreeConfig } from "../../utils/config";
import { gitSync, gitSyncQuiet, isolatedGitEnv } from "../../utils/git";
import { assertAgentGpgUnlocked } from "../../utils/gpg";
import { log, raw } from "../../utils/output";
import { scopedSignFlags } from "../scoped-worktree";
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
      scopedSignFlags(config.agentGpgKeyId),
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
      // Real co-authors on the squashed commits survive the squash: the
      // conventional subject gains their deduplicated Co-Authored-By
      // trailers (LLM-vendor ones dropped by the shared policy).
      const baseMsg = branchToSquashMessage(branch);
      const msg = squashMessageWithCoAuthors(
        config.repoRoot,
        baseMsg,
        `${targetBranch}..${branch}`,
        loadAllowedTrailers(config.repoRoot),
      );
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
        // `git merge --squash` stages but never commits (its -m is ignored
        // on the ff path) — produce the squash commit now, signed via the
        // same gpgMergeFlags, with the co-author-aware message.
        const msgFile = join(config.repoRoot, ".git", "GIWT_SQUASH_MSG");
        writeFileSync(msgFile, `${msg}\n`);
        let squashCommitFailed = false;
        const squashCommit = Bun.spawnSync([
          "git",
          "-C",
          config.repoRoot,
          ...flags,
          "commit",
          "-F",
          msgFile,
        ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
        try {
          unlinkSync(msgFile);
        } catch { /* best-effort scratch cleanup */ }
        if (squashCommit.exitCode !== 0) {
          log("error", "Squash commit failed");
          // `git merge --squash` already staged the integration, so bailing
          // out here would strand dev with staged-but-uncommitted contents
          // that block the next run's staged-entries gate. Unwind to the
          // pre-merge HEAD (the dirty dev state is on the stash, restored in
          // the finally below) so a plain retry works.
          const unwind = Bun.spawnSync([
            "git",
            "-C",
            config.repoRoot,
            "reset",
            "--hard",
            "HEAD",
          ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
          if (unwind.exitCode === 0) {
            log(
              "info",
              "Unwound the staged squash \u2014 dev is back at its pre-merge HEAD; re-run finalize to retry",
            );
          } else {
            raw(`  Recover manually: cd ${config.repoRoot} && git reset --hard HEAD`);
            raw(`  Then: re-run finalize`);
          }
          squashCommitFailed = true;
        }
        if (!squashCommitFailed) {
          setMergeInProgress(config.repoRoot, branch, preMergeHead, devStash, false);
          log("success", `Squash merged: ${baseMsg}`);
        }
        // Exit only after the finally below has restored the pre-merge stash;
        // a bare process.exit here would bypass it and leak the stash.
        if (squashCommitFailed) process.exit(1);
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
        // Direct merge's contract is a GPG-signed merge commit; FF would
        // skip merge-commit creation and move verify-commit onto the branch tip.
        "--no-ff",
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
