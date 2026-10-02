// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import { freemem } from "node:os";
import { resolve } from "path";
import { acquireCheckSlot, checkSlotCapacity, checkSlotDir } from "../../utils/check-slots";
import type { WorktreeConfig } from "../../utils/config";
import { gitSyncQuiet } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { activeRun } from "../../utils/runlog";
import {
  DEV_IN_PROGRESS_HEADS,
  isOrphanRebaseMarker,
  parseStashList,
  selectFinalizeStashes,
} from "../abort";
import { LAST_FAILED_GATES, resolveDiffBase, runCheck } from "./checks";
import { publishActiveCheckSlotRelease, releaseActiveCheckSlot } from "./state";

/**
 * Step 2 body for a worktree with a bun.lock: hold the cross-instance
 * check-fanout slot across the gate storm, run the check command, and exit(1)
 * with the failure outcome recorded when gates fail. The failure path never
 * returns, so the caller's Step 3 only runs after a green check gate.
 */
export function runCheckGateStep(
  wtPath: string,
  targetBranch: string,
  checkArgs: string[],
  config: WorktreeConfig,
): void {
  holdCheckFanoutSlot(config);
  try {
    // See resolveDiffBase for why we don't pass targetBranch directly.
    const diffBase = resolveDiffBase(wtPath, targetBranch);
    if (runCheck(wtPath, diffBase, checkArgs, config, activeRun()?.capturePath("check.log"))) {
      log("success", `Checks passed (diff-base=${diffBase.slice(0, 8)}…)`);
    } else {
      // LAST_FAILED_GATES names the actual gates when the check report
      // was parseable; without a report the failed gate is "check" itself.
      activeRun()?.outcome({
        failedGates: LAST_FAILED_GATES.length > 0 ? [...LAST_FAILED_GATES] : ["check"],
      });
      log("error", "Checks failed — fix before finalizing (or use --force)");
      process.exit(1);
    }
  } finally {
    releaseActiveCheckSlot();
  }
}
/**
 * Hold a user-level check-fanout slot for Step 2 (utils/check-slots). Memory
 * source mirrors the doctor pool sizing: [doctor] memory_budget_mb override,
 * else os.freemem(). On contention timeout, proceeds WITHOUT a slot (warn) —
 * the semaphore shapes contention across giwt instances, it never blocks or
 * refuses a finalize.
 */
function holdCheckFanoutSlot(config: WorktreeConfig): void {
  const budgetMb = config.settings.doctor.memoryBudgetMb;
  const availableMemMb = budgetMb > 0 ? budgetMb : Math.floor(freemem() / 2 ** 20);
  const slot = acquireCheckSlot({ dir: checkSlotDir(), availableMemMb });
  if (!slot) {
    log(
      "warn",
      `check-fanout slots busy — proceeding without a slot (cap ${
        checkSlotCapacity(availableMemMb)
      } tree(s) at ${availableMemMb} MB available)`,
    );
    return;
  }
  publishActiveCheckSlotRelease(slot.release);
}
/**
 * Precheck: refuse to start if the dev checkout is mid-merge / mid-rebase /
 * mid-cherry-pick, has unmerged paths, or has staged-but-uncommitted entries.
 *
 * This is the hard invariant. The lock below is best-effort single-flight;
 * these prechecks catch the cases where the dev tree is in a half-mutated
 * state that no lock acquisition can repair.
 */
export function checkDevMergeable(repoRoot: string): void {
  // 1. Unmerged paths (merge/rebase/cherry-pick left a tree with conflicts)
  const unmerged = gitSyncQuiet(repoRoot, "ls-files", "--unmerged");
  if (unmerged.length > 0) {
    log("error", "dev checkout has unmerged paths — resolve or abort before finalizing");
    raw("  git -C " + repoRoot + " status  (then resolve or git merge/rebase/cherry-pick --abort)");
    process.exit(1);
  }

  // 2. In-progress state sentinels (MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD)
  const gitDirRaw = gitSyncQuiet(repoRoot, "rev-parse", "--git-dir");
  const gitDirAbs = resolve(repoRoot, gitDirRaw.startsWith("/") ? gitDirRaw.slice(1) : gitDirRaw);
  for (const name of DEV_IN_PROGRESS_HEADS) {
    if (!existsSync(resolve(gitDirAbs, name))) continue;
    if (name === "REBASE_HEAD" && isOrphanRebaseMarker(gitDirAbs)) {
      // Orphan breadcrumb: the rebase already concluded (state dirs gone)
      // but the marker survived, e.g. after a SIGKILL. Blocking finalize
      // on a concluded operation deadlocks the abort → finalize recovery
      // flow; `giwt abort` removes the marker.
      log("warn", "ignoring orphan REBASE_HEAD marker (no rebase-merge/rebase-apply dirs)");
      continue;
    }
    const op = name.replace("_HEAD", "").toLowerCase();
    log(
      "error",
      `dev checkout is mid-${op} (${name} exists) — abort or resolve before finalizing`,
    );
    if (op === "merge") raw("  git merge --abort  (or commit the merge)");
    else if (op === "rebase") raw("  git rebase --abort  (or git rebase --continue)");
    else raw("  git cherry-pick --abort  (or git cherry-pick --continue)");
    process.exit(1);
  }

  // 3. Staged-but-uncommitted entries — these would interfere with the in-place
  // merge the same way untracked dirty files would.
  const staged = gitSyncQuiet(repoRoot, "diff", "--cached", "--name-only");
  if (staged.length > 0) {
    const stagedFiles = staged.split("\n").filter((s) => s.length > 0);
    log("error", `dev checkout has ${stagedFiles.length} staged-but-uncommitted entries`);
    raw("  git -C " + repoRoot + " commit  (or git -C " + repoRoot + " reset)");
    process.exit(1);
  }

  // 4. Leftover finalize stashes from a prior crashed finalize. Garbage from
  // the user's perspective but harmless if we leave them; warn so the
  // operator can `git stash drop` them.
  const leftovers = selectFinalizeStashes(
    parseStashList(gitSyncQuiet(repoRoot, "stash", "list")),
  );
  if (leftovers.length > 0) {
    log(
      "warn",
      `dev has ${leftovers.length} leftover finalize stash(es) from prior crash — review 'git stash list'`,
    );
  }
}
