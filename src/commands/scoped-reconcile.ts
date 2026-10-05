// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Finalize Step 5.5: post-merge plan reconciliation on the target checkout.
 * Split out of scoped-worktree.ts (size budget) — used by `giwt finalize`
 * for EVERY non-alreadyMerged finalize, not only scoped worktrees.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildMap, writeMap } from "../plan/code-map";
import { genMatrix } from "../plan/feature-matrix";
import { runSync } from "../tickets/sync-index";
import { assertGitAuthorIdentity } from "../utils/author-guard";
import { type WorktreeConfig } from "../utils/config";
import { gitSync, isolatedGitEnv } from "../utils/git";
import { log } from "../utils/output";

/** -c overrides for the Step 5.5 in-place commit — mirrors finalize's
 * gpgMergeFlags so the reconciliation commit is signed exactly when an
 * agent key is configured (cold-cache repos keep repo-local config). */
export function scopedSignFlags(agentGpgKeyId: string | undefined): string[] {
  return agentGpgKeyId
    ? ["-c", "commit.gpgsign=true", "-c", `user.signingkey=${agentGpgKeyId}`]
    : [];
}

/**
 * Finalize Step 5.5: post-merge plan reconciliation on the target checkout
 * (repoRoot) — for EVERY non-alreadyMerged finalize, not only scoped
 * worktrees (FEAT-universal-post-merge-plan-reconciliation). runSync --fix
 * repairs the merged index/tickets, generated artifacts are regenerated,
 * and the result commits on the target branch. Idempotent: a rerun after a
 * crash finds a consistent tree and skips the commit. No plan dir → no-op.
 */
export function reconcilePlanPostMerge(config: WorktreeConfig, args: string[]): void {
  const planDir = resolve(config.repoRoot, config.settings.paths.planDir);
  if (!existsSync(planDir)) {
    log("info", "Step 5.5: no plan dir — nothing to reconcile");
    return;
  }
  runSync(config.repoRoot, { fix: true, ticketsPath: config.settings.paths.tickets });
  const matrixPath = join(planDir, "feature-matrix.md");
  if (existsSync(matrixPath)) {
    genMatrix(join(planDir, "tickets", "index.json"), matrixPath);
  }
  const mapPath = join(planDir, "code-map.json");
  if (existsSync(mapPath)) {
    writeMap(
      mapPath,
      buildMap(config.repoRoot, [
        { dir: `${config.settings.paths.planDir}/tickets`, kind: "ticket" },
        { dir: `${config.settings.paths.planDir}/epics`, kind: "epic" },
      ]),
    );
  }
  // Stage first: runSync --fix writes to the working tree, so `--cached`
  // only sees the change after the add. A clean stage afterwards means the
  // tree was already consistent (idempotent rerun) — skip the commit.
  gitSync(config.repoRoot, "add", "-f", config.settings.paths.planDir);
  const staged = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "diff", "--cached", "--quiet"],
    { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
  );
  if (staged.exitCode !== 0) {
    // Guard: the reconciliation commit lands on the target branch from the
    // repoRoot identity — refuse a tampered repo author before committing.
    assertGitAuthorIdentity({
      cwd: config.repoRoot,
      expectedEmail: config.agentGpgEmail ?? "",
      args,
      source: "post-merge reconciliation",
    });
    const signFlags = scopedSignFlags(config.agentGpgKeyId);
    gitSync(
      config.repoRoot,
      ...signFlags,
      "commit",
      "-m",
      "chore(plan): post-merge reconciliation",
    );
    log("success", "Step 5.5: plan reconciliation committed");
  } else {
    log("info", "Step 5.5: plan state already consistent — no commit");
  }
}
