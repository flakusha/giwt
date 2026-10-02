// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import { join, resolve } from "path";
import { BACKLOG_INDEX_FILES } from "../../plan/backlog-sync";
import { ALL_GATES, runValidate } from "../../plan/validate";
import type { GateName } from "../../plan/validate";
import { runSync } from "../../tickets/sync-index";
import type { WorktreeConfig } from "../../utils/config";
import { gitSync, gitSyncQuiet, isolatedGitEnv } from "../../utils/git";
import { printRecentLedger } from "../../utils/ledger";
import { log, raw, section } from "../../utils/output";
import { activeRun } from "../../utils/runlog";
import { closeScopedIssues, readScopedMeta, reconcileScopedPlan } from "../scoped-worktree";
import { resolveDiffBase, runTests } from "./checks";
import { runCheckGateStep } from "./gates";
import { executeMergeStep } from "./merge-exec";
import { teardownFinalizedWorktree } from "./teardown";

export async function runFinalize(
  branch: string,
  mergeStrategy: string,
  force: boolean,
  gatesFilter: string,
  skipGatesFilter: string,
  planGatesFilter: string,
  jobs: string,
  config: WorktreeConfig,
  wtPath: string,
  targetBranch: string,
): Promise<void> {
  section(`Finalizing '${branch}'`);
  // Shared-state view: what agents recorded lately, before mutating dev.
  printRecentLedger(config.treeDir, 10);
  // Step 1: Check worktree clean
  log("info", "Step 1: Checking worktree state...");
  const dirty = Bun.spawnSync(["git", "-C", wtPath, "diff", "--quiet"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const staged = Bun.spawnSync(["git", "-C", wtPath, "diff", "--cached", "--quiet"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
    log("error", "uncommitted changes detected — commit or stash before finalizing");
    raw(`  cd ${wtPath} && git add -A && git commit -m 'feat: ...'`);
    raw(`  cd ${wtPath} && git stash`);
    process.exit(1);
  }
  log("success", "Worktree clean");

  // Plan validation gate (if --plan-gates specified)
  if (planGatesFilter) {
    log("info", `Plan validation (--plan-gates ${planGatesFilter})...`);
    if (force) {
      log("warn", "Skipped: --force flag set");
    } else {
      const planDirName = config.settings.paths.planDir;
      const planDir = join(wtPath, planDirName);
      const gateNames = planGatesFilter === "all"
        ? [...ALL_GATES]
        : planGatesFilter.split(",").map((g) => g.trim()).filter(Boolean);
      const planResult = runValidate({
        projectRoot: wtPath,
        worktreeRoot: wtPath,
        ticketsDir: join(planDir, "tickets"),
        epicsDir: join(planDir, "epics"),
        backlogDir: join(planDir, "backlog"),
        planDir,
        srcDir: "src",
        codeMapPath: join(planDir, "code-map.json"),
        epicsIndexPath: join(planDir, "epics-index.md"),
        mapSources: [
          { dir: `${planDirName}/tickets`, kind: "ticket" },
          { dir: `${planDirName}/epics`, kind: "epic" },
          { dir: "docs/spec", kind: "spec" },
          { dir: "docs/frontend", kind: "frontend" },
        ],
        linkScanDirs: ["docs", planDirName],
        backlogIndexFiles: [...BACKLOG_INDEX_FILES],
        gates: gateNames as GateName[],
        // Scope per-file gates (format/linkage/status-vocab) to the branch's
        // changes: foreign tickets committed by concurrently-active sessions
        // must not fail this finalize (TASK-plan-validate-scope-ticket-format-
        // link-gates-to-the-diff-bas). Opt-out: [commands] diff_base = false.
        ...(config.settings.commands.diffBase !== false
          ? { diffBase: resolveDiffBase(wtPath, targetBranch) }
          : {}),
        runSync: (root, opts) =>
          runSync(root, {
            fix: opts.fix,
            verbose: opts.verbose,
            ticketsPath: opts.ticketsPath,
          }),
      });
      if (planResult.pass) {
        log("success", `Plan validation passed (${planResult.results.length} gates)`);
      } else {
        log(
          "error",
          `Plan validation failed — ${planResult.issueCount} issue(s) found (or use --force)`,
        );
        for (const r of planResult.results) {
          if (!r.pass) {
            raw(`  ✗ ${r.gate}`);
            for (const f of r.findings) {
              if (f.level === "error") {
                raw(`    ${f.message}`);
              }
            }
          }
        }
        // Outcome before exit: process.exit bypasses the dispatch catch,
        // the exit hook only backfills end/exitCode, never outcome data.
        activeRun()?.outcome({
          failedGates: planResult.results.filter((r) => !r.pass).map((r) => r.gate),
        });
        process.exit(1);
      }
    }
  }

  // Step 2: Run checks
  log("info", `Step 2: Running checks (${config.settings.commands.check})...`);
  if (force) {
    log("warn", "Skipped: --force flag set");
  } else {
    const checkArgs: string[] = [];
    if (gatesFilter) {
      checkArgs.push("--gates", gatesFilter);
    } else if (skipGatesFilter) {
      checkArgs.push("--skip-gates", skipGatesFilter);
    }
    if (jobs) {
      checkArgs.push("--jobs", jobs);
    }
    const hasBunLock = existsSync(resolve(wtPath, "bun.lock"));
    if (hasBunLock) {
      runCheckGateStep(wtPath, targetBranch, checkArgs, config);
    } else {
      log("warn", "Skipped: no bun.lock found");
    }
  }

  // Step 3: Run tests
  log("info", `Step 3: Running tests (${config.settings.commands.test})...`);
  if (force) {
    log("warn", "Skipped: --force flag set");
  } else {
    const hasBunLock = existsSync(resolve(wtPath, "bun.lock"));
    if (hasBunLock && runTests(wtPath, config, activeRun()?.capturePath("test.log"))) {
      log("success", "Tests passed");
    } else if (!hasBunLock) {
      log("warn", "Skipped: no bun.lock found");
    } else {
      activeRun()?.outcome({ failedGates: ["tests"] });
      log("error", "Tests failed — fix before finalizing (or use --force)");
      raw(`  Full test log: ${activeRun()?.capturePath("test.log") ?? "(not captured)"}`);
      process.exit(1);
    }
  }

  // Step 4: Check branch has commits beyond base
  log("info", "Step 4: Checking commits...");
  const aheadStr = gitSync(wtPath, "rev-list", "--count", `${targetBranch}..HEAD`);
  const ahead = parseInt(aheadStr || "0", 10);
  // The target already contains HEAD (manual merge, or an interrupted earlier
  // finalize): there is nothing to merge or reconcile, but teardown (Steps
  // 6/7) is part of finalize's contract and MUST still run — exiting here
  // leaks the worktree directory, its .git/worktrees admin entry, and the
  // branch ref while reporting success.
  const alreadyMerged = ahead === 0;
  if (alreadyMerged) {
    log("warn", `Branch '${branch}' has no commits beyond ${targetBranch} — nothing to merge`);
  } else {
    log("success", `Branch has ${ahead} commit(s) beyond ${targetBranch}`);
  }

  const scopedMeta = readScopedMeta(wtPath);
  if (!alreadyMerged && scopedMeta !== null && scopedMeta.tickets.length > 0) {
    closeScopedIssues(config.repoRoot, scopedMeta.tickets);
  }

  executeMergeStep(branch, mergeStrategy, force, config, wtPath, targetBranch, alreadyMerged);

  // Record the merge result while the tree still exists: the run record
  // itself lives under repoRoot now, but the SHA is the durable answer to
  // "what did this finalize land" (head of the target branch post-merge).
  activeRun()?.outcome({ mergeCommit: gitSyncQuiet(config.repoRoot, "rev-parse", "HEAD") });

  // Step 5.5: scoped-worktree plan reconciliation (post-merge). runSync --fix
  // maps the closed issues' Done state into the merged .md files and index,
  // the generated plan artifacts are regenerated, and the result lands as a
  // signed in-place commit on the target branch.
  if (!alreadyMerged && scopedMeta !== null && scopedMeta.tickets.length > 0) {
    log("info", "Step 5.5: scoped-worktree plan reconciliation...");
    reconcileScopedPlan(config);
  }

  teardownFinalizedWorktree(branch, wtPath, config, alreadyMerged, targetBranch);
}
