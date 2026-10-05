// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt finalize` public shell.
 *
 * The implementation lives in cohesive submodules under `finalize/`:
 *   - `finalize/lock.ts`         — finalize lock acquisition + FIFO wait queue
 *   - `finalize/lock-report.ts`  — held-lock diagnostics (PID, age, recovery)
 *   - `finalize/state.ts`        — abort-state slot + signal-safe rollback plumbing
 *   - `finalize/gates.ts`        — prechecks + Step-2 check gate + fanout slots
 *   - `finalize/checks.ts`       — check/test runners + failure reporting
 *   - `finalize/merge.ts`        — squash-message/CLI arg helpers (--onto)
 *   - `finalize/staging.ts`      — Step 5 merge in an ephemeral staging worktree
 *   - `finalize/run.ts`          — runFinalize orchestration (Steps 1–5.5)
 *   - `finalize/teardown.ts`     — Steps 6/7 worktree + branch teardown
 *
 * Every historically exported name stays importable from this module path.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { branchToPath, findWorktree, type WorktreeConfig } from "../utils/config";
import { gitSync, isolatedGitEnv, isProtected } from "../utils/git";
import { appendGripe } from "../utils/ledger";
import { log, raw } from "../utils/output";
import { installFailureGripe } from "./finalize/checks";
import { checkDevMergeable } from "./finalize/gates";
import { acquireFinalizeLock } from "./finalize/lock";
import { parseFinalizeArgs } from "./finalize/merge";
import { runFinalize } from "./finalize/run";
import {
  installSignalHandlers,
  publishActiveLockRelease,
  uninstallSignalHandlers,
} from "./finalize/state";

export { resolveDiffBase } from "./finalize/checks";
export {
  acquireFinalizeLock,
  lockRetryDelayMs,
  queuePollDelayMs,
  queueWaitMs,
} from "./finalize/lock";
export { reportHeldLock } from "./finalize/lock-report";
export { parseFinalizeArgs } from "./finalize/merge";

export async function finalize(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  let gripeBranch = "";
  installFailureGripe(config.treeDir, () => gripeBranch);
  // finalize is allowed from inside the worktree (e.g. while iterating on it):
  // the explicit branch arg identifies the target worktree, and loadConfig now
  // resolves repoRoot correctly via --git-common-dir regardless of cwd.
  let branch = "";
  let mergeStrategy = "rebase";
  let force = false;
  let gatesFilter = "";
  let skipGatesFilter = "";
  let planGatesFilter = "";
  let jobs = "";
  const parsed = parseFinalizeArgs(args.filter((a) => a !== "--allow-author-override"));
  branch = parsed.branch;
  mergeStrategy = parsed.mergeStrategy;
  force = parsed.force;
  gatesFilter = parsed.gatesFilter;
  skipGatesFilter = parsed.skipGatesFilter;
  planGatesFilter = parsed.planGatesFilter;
  jobs = parsed.jobs;
  gripeBranch = branch;

  if (!["rebase", "squash", "direct"].includes(mergeStrategy)) {
    log("error", `unknown merge strategy '${mergeStrategy}' — use rebase, squash, or direct`);
    process.exit(1);
  }

  if (!branch) {
    log("error", "branch name required");
    raw(
      "  Usage: giwt finalize <branch> [--merge-strategy rebase|squash|direct] [--onto <branch>] [--force] [--gates <csv>] [--skip-gates <csv>] [--jobs <n>]",
    );
    process.exit(1);
  }

  // Resolve directory name to branch name
  const dirName = branchToPath(branch);
  const dirPath = resolve(config.treeDir, dirName);
  if (existsSync(resolve(dirPath, ".git"))) {
    const headRef = gitSync(dirPath, "symbolic-ref", "--short", "HEAD");
    if (headRef && headRef !== branch) {
      log("info", `Resolved '${branch}' → branch '${headRef}'`);
      branch = headRef;
      gripeBranch = branch;
    }
  }

  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot finalize protected branch '${branch}'`);
    process.exit(1);
  }

  const wtPath = findWorktree(branch, config);
  if (!wtPath) {
    log("error", `no worktree found for branch '${branch}'`);
    process.exit(1);
  }

  // Target ref: --onto wins, else the configured root branch
  // (FEAT-merge-in-staging-worktree-with-ref-move). The staging merge moves
  // refs/heads/<target> via update-ref CAS — the dev checkout no longer
  // needs to hold the target, so a detached dev is fine (lazy dev sync
  // warns instead of refusing, and never auto-stashes).
  const targetBranch = parsed.onto || config.settings.branches.root;
  const refCheck = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${targetBranch}`],
    {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (refCheck.exitCode !== 0) {
    log("error", `target branch '${targetBranch}' not found`);
    raw(`  Then: pass --onto <branch>, or set [branches] root in giwt.toml`);
    process.exit(1);
  }

  // Fail-fast precheck only: the authoritative mergeable check re-runs under
  // the lock just before the merge — across minutes of gates this pre-lock
  // result goes stale (TOCTOU), so it must never be the sole guard.
  checkDevMergeable(config.repoRoot);
  // The lock + signal handlers are acquired at the MERGE phase, not here:
  // steps 1-4 (checks, tests) run unlocked so a queued finalizer ages its
  // base by seconds instead of the whole gate storm
  // (FEAT-narrow-finalize-lock-to-merge-steps).
  //
  // Gates-phase signal path, stated explicitly: with no handler installed a
  // SIGINT/SIGTERM/SIGHUP takes Node's default disposition and terminates
  // the process. That is safe — no lock is held, no merge is in progress,
  // and the `process.on('exit')` cleanup is not installed yet either, so
  // there is nothing to roll back and nothing to release.
  const runMergePhase = <T>(merge: () => T): T => {
    const releaseFinalizeLock = acquireFinalizeLock(config.repoRoot);
    // Publish the release fn so the `process.on('exit')` cleanup (installed
    // by installSignalHandlers) can call it on every termination path —
    // including operator-error paths inside the merge phase that call
    // `process.exit(1)` directly and bypass this try/finally. The finally
    // still calls release() on the success/error path; release is
    // idempotent so the `exit` handler and the finally racing is harmless.
    publishActiveLockRelease(releaseFinalizeLock);
    // Install signal handlers AFTER acquiring the lock. Order matters:
    // 1. lock first — so a signal can't race against an unlocked dev tree;
    // 2. handlers second — they release the lock during rollback.
    // Uninstall runs in `finally` BEFORE clearing the module-scoped release,
    // otherwise the handler could be invoked after the release fn is gone and
    // try to call a stale closure. The signal exit code (130) is propagated
    // by process.exit inside the handler, so the cleanup below only runs on
    // the happy / operator-error path.
    installSignalHandlers();
    try {
      // Re-check under the lock: the pre-gates check went stale across the
      // gate storm. A dev checkout that turned dirty mid-gates (staged
      // entries, mid-merge sentinels) must refuse here instead of being
      // stashed through the merge.
      checkDevMergeable(config.repoRoot);
      return merge();
    } finally {
      uninstallSignalHandlers();
      releaseFinalizeLock();
      publishActiveLockRelease(null);
    }
  };
  try {
    await runFinalize(
      branch,
      mergeStrategy,
      force,
      gatesFilter,
      skipGatesFilter,
      planGatesFilter,
      jobs,
      config,
      wtPath,
      targetBranch,
      runMergePhase,
      args,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    appendGripe(config.treeDir, branch, `finalize ${branch} failed: ${reason}`);
    throw error;
  }
}
