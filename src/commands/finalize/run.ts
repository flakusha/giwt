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
import { closeScopedIssues, readScopedMeta, reconcilePlanPostMerge } from "../scoped-worktree";
import { resolveDiffBase, runTests } from "./checks";
import { ensureWorktreeClean } from "./clean-state";
import { runCheckGateStep } from "./gates";
import { executeStagingMerge } from "./staging";
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
  runMergePhase: <T>(merge: () => T) => T,
): Promise<void> {
  section(`Finalizing '${branch}'`);
  // Shared-state view: what agents recorded lately, before mutating dev.
  printRecentLedger(config.treeDir, 10);
  // Step 1: Check worktree clean
  const wtMissing = ensureWorktreeClean(wtPath);

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
            ...(opts.diffBase ? { diffBase: opts.diffBase } : {}),
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
  // ahead counts COMMITS, not content: a cherry-picked branch has commits
  // beyond the target whose patches already landed there under different
  // SHAs. `git cherry <target> HEAD` marks each patch-equivalent commit
  // '-'; every line '-' (or empty output) means the branch's changes are
  // all in the target and there is nothing left to merge. When cherry
  // itself fails (unresolvable ref), fall back to the ahead-count check.
  let ahead = 0;
  let alreadyMerged = true;
  if (!wtMissing) {
    ahead = parseInt(gitSync(wtPath, "rev-list", "--count", `${targetBranch}..HEAD`) || "0", 10);
    const cherry = Bun.spawnSync(["git", "-C", wtPath, "cherry", targetBranch, "HEAD"], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const cherryList = cherry.stdout.toString().trim();
    const cherryUsable = cherry.exitCode === 0;
    const cherryEquivalent = cherryUsable
      && (cherryList === "" || cherryList.split("\n").every((line) => line.startsWith("-")));
    alreadyMerged = cherryUsable ? cherryEquivalent : ahead === 0;
  }
  // The target already contains HEAD's changes (manual merge, cherry-pick,
  // or an interrupted earlier finalize): there is nothing to merge or
  // reconcile, but teardown (Steps 6/7) is part of finalize's contract and
  // MUST still run — exiting here leaks the worktree directory, its
  // .git/worktrees admin entry, and the branch ref while reporting success.
  if (alreadyMerged) {
    if (ahead > 0) {
      log(
        "warn",
        `Branch '${branch}' commits are patch-equivalent to ${targetBranch} (cherry-picked?) — nothing to merge`,
      );
    } else {
      log("warn", `Branch '${branch}' has no commits beyond ${targetBranch} — nothing to merge`);
    }
  } else {
    log("success", `Branch has ${ahead} commit(s) beyond ${targetBranch}`);
  }

  const scopedMeta = readScopedMeta(wtPath);
  if (!alreadyMerged && scopedMeta !== null && scopedMeta.tickets.length > 0) {
    closeScopedIssues(config.repoRoot, scopedMeta.tickets);
  }

  // Merge phase: the only locked span of finalize. Steps 1-4 above ran
  // unlocked; from here through teardown the finalize lock + signal
  // handlers are held (installed by the injected runMergePhase), so a
  // queued finalizer waits seconds, not the gate storm
  // (FEAT-narrow-finalize-lock-to-merge-steps).
  runMergePhase(() => {
    // Merge in the ephemeral staging worktree (never in dev); the target
    // ref moves via update-ref CAS and dev syncs lazily.
    const staged = executeStagingMerge(
      branch,
      mergeStrategy,
      force,
      config,
      targetBranch,
      alreadyMerged,
    );

    // Record the merge result: the SHA is the durable answer to "what did
    // this finalize land" (the CAS-moved target ref, not dev's HEAD — dev
    // may legitimately lag when its working tree was dirty).
    const mergeCommit = staged?.targetSha
      ?? gitSyncQuiet(config.repoRoot, "rev-parse", `refs/heads/${targetBranch}`);
    activeRun()?.outcome({ mergeCommit });

    // Step 5.5: universal post-merge plan reconciliation. runSync --fix maps
    // the closed issues' Done state into the merged .md files and index, the
    // generated plan artifacts are regenerated, and the result lands as a
    // signed in-place commit on the target branch — for every non-
    // alreadyMerged finalize, not only scoped worktrees. It commits in the
    // dev checkout, so it only runs when the lazy sync actually moved dev
    // onto the new target — a dirty/detached dev would commit on the wrong
    // base.
    if (!alreadyMerged) {
      if (staged?.devSynced) {
        log("info", "Step 5.5: post-merge plan reconciliation...");
        reconcilePlanPostMerge(config);
      } else {
        log(
          "warn",
          `Step 5.5 skipped: dev checkout not synced to ${targetBranch} — re-run 'giwt sync --fix' after syncing manually`,
        );
      }
    }

    teardownFinalizedWorktree(branch, wtPath, config, alreadyMerged, targetBranch);
  });
}
