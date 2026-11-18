// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Colocated-jj history audit.
 *
 * Authority split:
 * - GIT PLUMBING is authoritative for CONTENT: commit walks, stable
 *   patch-ids and blobs come from the colocated git store via ./patch-ids,
 *   the same calls git mode uses. No blob or patch-id logic lives here.
 * - JJ CHANGE IDS are authoritative for IDENTITY: a rewrite keeps its
 *   change ID while its git commit id changes, so change IDs (not shas or
 *   patch-ids) decide whether a commit was already applied upstream.
 *
 * This module is reached only when [vcs] backend = "jj" on a colocated
 * repo. Git-only mode never calls it and never spawns jj. evolog is not
 * needed: the backing git store plus change IDs cover both content and
 * identity without extra jj calls.
 */

import type { AuditLinearity } from "../utils/settings";
import { type AuditFinding, auditHistory, type AuditReport, type FindingReason } from "./audit";
import { defaultJjHistorySpawn, jjChangeIds, type JjHistorySpawn } from "./jj-history";
import { historyGit, walkRange } from "./patch-ids";

/** jj-mode finding reasons: git's four plus the change-ID rewrite signal. */
export type JjFindingReason = FindingReason | "duplicate-change-id";

export interface JjAuditFinding extends Omit<AuditFinding, "reason"> {
  reason: JjFindingReason;
  /** Stable jj change ID, present when jj resolves the commit. */
  changeId?: string;
}

export interface JjAuditReport extends Omit<AuditReport, "findings"> {
  findings: Partial<Record<JjFindingReason, JjAuditFinding[]>>;
}

const REASON_ORDER: readonly JjFindingReason[] = [
  "duplicate-patch-id",
  "duplicate-rename-insensitive",
  "empty-commit",
  "merge-in-range",
  "duplicate-change-id",
];

/**
 * Audit <onto>..<branch> in a colocated jj repo. auditHistory produces the
 * shape and git-plumbing findings; jj change IDs (including hidden rewritten
 * commits, via jjChangeIds' commit_id(...) revsets) annotate them and add
 * the rewrite/duplicate signal keyed on change ID.
 */
export function auditJjHistory({
  root,
  branch,
  onto,
  spawn = defaultJjHistorySpawn,
  linearity,
  patchIds,
  maxFindings,
}: {
  root: string;
  branch: string;
  onto: string;
  spawn?: JjHistorySpawn;
  linearity: AuditLinearity;
  patchIds: boolean;
  maxFindings: number;
}): JjAuditReport {
  const base = auditHistory({ root, branch, onto, linearity, patchIds, maxFindings });

  const commits = walkRange({ root, range: `${onto}..${branch}`, withPatchIds: false });
  // ponytail: target shas come from git refs only; a rewrite no longer reachable
  // from `onto` stays invisible. Enumerate evolog if that case ever matters.
  const targetShas = historyGit({ root, args: ["rev-list", "--no-merges", onto] })
    .out.split("\n").map((line) => line.trim()).filter(Boolean);
  const ids = jjChangeIds({ root, shas: [...commits.map((c) => c.sha), ...targetShas], spawn });

  const targetChanges = new Map<string, string[]>();
  for (const sha of targetShas) {
    const change = ids.get(sha);
    if (change === undefined) continue;
    const twins = targetChanges.get(change);
    if (twins === undefined) targetChanges.set(change, [sha]);
    else twins.push(sha);
  }

  const flat: JjAuditFinding[] = [];
  for (const list of Object.values(base.findings) as AuditFinding[][]) {
    for (const finding of list) {
      const changeId = ids.get(finding.sha);
      flat.push({ ...finding, ...(changeId === undefined ? {} : { changeId }) });
    }
  }
  for (const commit of commits) {
    const changeId = ids.get(commit.sha);
    if (changeId === undefined) continue;
    const twins = targetChanges.get(changeId);
    if (twins === undefined) continue;
    flat.push({
      reason: "duplicate-change-id",
      sha: commit.sha,
      changeId,
      subject: commit.subject,
      patchId: null,
      twins,
      evidence: `jj change ${changeId} (commit ${
        commit.sha.slice(0, 7)
      }) is already in ${onto} as ${
        twins[0]!.slice(0, 7)
      }; change IDs survive rewrites, so replaying would apply the same change twice`,
    });
  }

  flat.sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason));
  const cap = Math.max(0, maxFindings);
  const findings: JjAuditReport["findings"] = {};
  for (const finding of flat.slice(0, cap)) {
    const group = findings[finding.reason];
    if (group === undefined) findings[finding.reason] = [finding];
    else group.push(finding);
  }
  const total = Math.max(flat.length, base.findingsTotal ?? 0);
  return {
    ...base,
    findings,
    ...(total > cap ? { findingsTotal: total } : {}),
    exit: flat.length > 0 ? 1 : 0,
  };
}
