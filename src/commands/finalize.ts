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
 *   - `finalize/merge.ts`        — stash/restore helpers + CLI arg parsing
 *   - `finalize/merge-exec.ts`   — Step 5 merge strategies (rebase/squash/direct)
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
  const parsed = parseFinalizeArgs(args);
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
      "  Usage: giwt finalize <branch> [--merge-strategy rebase|squash|direct] [--force] [--gates <csv>] [--skip-gates <csv>] [--jobs <n>]",
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

  // Resolve the merge target the way getRootBranch does — but refuse a
  // detached main checkout instead of silently falling back to the literal
  // "master", which would merge the feature branch into a ref the operator
  // never named and rewrite it in place (TASK-reach-parity AC 1). Preflight:
  // must run BEFORE checkDevMergeable/acquireFinalizeLock so a refusal never
  // takes the lock or touches the dev checkout.
  const showCurrent = Bun.spawnSync(["git", "-C", config.repoRoot, "branch", "--show-current"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const targetBranch = showCurrent.stdout.toString().trim();
  if (!targetBranch) {
    const headSha = gitSync(config.repoRoot, "rev-parse", "HEAD");
    log(
      "error",
      `${config.repoRoot}: main checkout is detached at ${headSha} - checkout the root branch (or stash) before finalizing`,
    );
    raw(`  Then: git -C ${config.repoRoot} checkout <root-branch>`);
    process.exit(1);
  }

  // Refuse concurrent or in-flight dev-checkout operations BEFORE doing
  // anything that mutates `repoRoot`. See BUG-finalize-race: two concurrent
  // finalizes race on stash push/pop around an in-place merge, which can leave
  // files in "modified" instead of cancelling cleanly. The precheck is the
  // hard invariant; the lock is best-effort single-flight.
  checkDevMergeable(config.repoRoot);
  const releaseFinalizeLock = acquireFinalizeLock(config.repoRoot);
  // Publish the release fn so the `process.on('exit')` cleanup (installed
  // by installSignalHandlers) can call it on every termination path —
  // including operator-error paths inside runFinalize that call
  // `process.exit(1)` directly and bypass the outer try/finally. The outer
  // finally still calls release() on the success/error path; release is
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
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      appendGripe(config.treeDir, branch, `finalize ${branch} failed: ${reason}`);
      throw error;
    } finally {
      uninstallSignalHandlers();
    }
  } finally {
    releaseFinalizeLock();
    publishActiveLockRelease(null);
  }
}
