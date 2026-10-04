// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Rebase with automatic .plan/ conflict reconciliation — public surface.
 *
 * `rebaseWithPlanReconciliation` loops `git rebase` + three auto-resolve
 * passes: generated-plan artifacts are merged/regenerated (see
 * ./reconcile-conflicts/generated), content conflicts whose two stages
 * form a strict superset relationship are resolved to the superset side
 * (see ./reconcile-conflicts/supersets), and ticket .md header conflicts
 * are merged by rule — done-wins, tag union, issue-ref append — (see
 * ./reconcile-conflicts/ticket-headers). Anything else stops the rebase and
 * is returned to the caller.
 */

import { log } from "../utils/output";
import { completeGeneratedReconcile, resolveGenerated } from "./reconcile-conflicts/generated";
import { isAncestorOf, runGit, unmergedPaths } from "./reconcile-conflicts/git-io";
import { autoResolveSupersets } from "./reconcile-conflicts/supersets";
import { resolveTicketHeaderConflicts } from "./reconcile-conflicts/ticket-headers";

export { isAncestorOf } from "./reconcile-conflicts/git-io";
export { mergeIndexRecords } from "./reconcile-conflicts/json-merge";
export { strictSupersetSide } from "./reconcile-conflicts/supersets";

export interface RebaseResult {
  exitCode: number;
  output: string;
  generatedConflicts: string[];
  /** Paths auto-resolved because one conflict side was a strict superset. */
  autoResolved: string[];
}

export function rebaseWithPlanReconciliation(
  root: string,
  target: string,
  planDir: string,
  ticketsPath: string,
  /** GPG pin flags for the rebase replays and the final amend commit
   * (BUG-reconcile-conflicts GPG): `git rebase` re-signs the whole replayed
   * tail, so the flags must wrap the rebase invocation itself, not only the
   * reconcile amend. */
  signFlags: string[] = [],
): RebaseResult {
  // A contained target means there is nothing to replay, but `git rebase` still
  // rewrites and re-signs the branch's whole tail byte-identically - and each
  // round feeds its own rewritten SHAs back as the next round's range.
  if (isAncestorOf(root, target, "HEAD")) {
    const branch = runGit(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
    log("info", `'${target}' is already contained in '${branch}' - nothing to rebase.`);
    return {
      exitCode: 0,
      output: `Already up to date: '${target}' is contained in HEAD. Rebase skipped.`,
      generatedConflicts: [],
      autoResolved: [],
    };
  }

  let result = runGit(root, ...signFlags, "rebase", target);
  let output = result.stdout + result.stderr;
  const generatedConflicts: string[] = [];
  const autoResolved: string[] = [];

  while (result.exitCode !== 0) {
    // Per-round resolution is deliberately cheap (index three-way merge only;
    // other artifacts take the replayed side). The expensive regenerate walk
    // runs once, after the loop.
    const resolved = resolveGenerated({ root, planDir, ticketsPath });
    generatedConflicts.push(...resolved);
    const supersets = autoResolveSupersets(root);
    autoResolved.push(...supersets);
    const headerResolved = resolveTicketHeaderConflicts(root, ticketsPath);
    autoResolved.push(...headerResolved);
    if (
      (resolved.length === 0 && supersets.length === 0 && headerResolved.length === 0)
      || unmergedPaths(root).length > 0
    ) {
      return { exitCode: result.exitCode, output, generatedConflicts, autoResolved };
    }
    result = runGit(root, ...signFlags, "rebase", "--continue");
    output += result.stdout + result.stderr;
  }

  if (result.exitCode === 0 && generatedConflicts.length > 0) {
    // One regeneration + one amend for the whole replayed tail, instead of
    // one regeneration per replayed commit.
    completeGeneratedReconcile(root, planDir, ticketsPath, signFlags);
  }

  return { exitCode: 0, output, generatedConflicts, autoResolved };
}
