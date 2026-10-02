// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Reconcile check passes split out of `reconcile` (sync-reconcile.ts):
 * git_issue linking, stale/orphan registry state, issue-lifecycle drift,
 * .md/index status drift, and epic binding. Order of execution — and
 * therefore report population order — is owned by `reconcile`.
 */

import { normalizeStatus } from "./sync-normalize";
import type { GitIssue, IndexEntry, SyncReport, TicketFile } from "./sync-ticket-types";

// 6. Find missing git_issue links: index entries that have hash (commit) but
//    no git_issue field, where a matching open git issue exists by extid.
//    Build extid→issue lookup from git issues.
export function checkMissingGitIssueLinks(
  report: SyncReport,
  index: Record<string, IndexEntry>,
  gitIssues: Map<string, GitIssue>,
): void {
  const issueByExtid = new Map<string, GitIssue>();
  for (const [, issue] of gitIssues) {
    if (issue.extid && !issueByExtid.has(issue.extid)) {
      issueByExtid.set(issue.extid, issue);
    }
  }

  for (const [extid, entry] of Object.entries(index)) {
    if (entry.git_issue) continue; // already linked
    const issue = issueByExtid.get(extid);
    if (issue) {
      report.missingGitIssueLinks.push({
        extid,
        suggestedGitIssue: issue.hash,
        gitTitle: issue.title,
      });
    }
  }
}

// 7. Stale open git issues: index entry is done/closed but linked git_issue
//    is still open.
export function checkStaleOpenGitIssues(
  report: SyncReport,
  index: Record<string, IndexEntry>,
  gitIssues: Map<string, GitIssue>,
): void {
  for (const [extid, entry] of Object.entries(index)) {
    if (!entry.git_issue) continue;
    const indexStatus = normalizeStatus(entry.status ?? "");
    if (indexStatus !== "done") continue;

    const issue = gitIssues.get(entry.git_issue);
    if (issue && issue.status === "open") {
      report.staleOpenGitIssues.push({
        extid,
        gitIssueHash: entry.git_issue,
        indexStatus,
      });
    }
  }
}

// 8. Orphan git issues: open git issues with no matching index entry by extid.
export function checkOrphanGitIssues(
  report: SyncReport,
  index: Record<string, IndexEntry>,
  gitIssues: Map<string, GitIssue>,
): void {
  const indexExtids = new Set(Object.keys(index).map((k) => k.toUpperCase()));

  for (const [, issue] of gitIssues) {
    if (issue.status !== "open") continue;
    if (!issue.extid) continue;
    if (!indexExtids.has(issue.extid)) {
      report.orphanGitIssues.push({
        hash: issue.hash,
        extid: issue.extid,
        title: issue.title,
      });
    }
  }
}

// 10. Issue-lifecycle drift (import / foreign / duplicate / move):
//     keyed per extid across ALL issues (the lookups above stop at the
//     first match, which hides duplicates and reclassified tickets).
export function checkIssueLifecycleDrift(
  report: SyncReport,
  ticketFiles: TicketFile[],
  gitIssues: Map<string, GitIssue>,
  index: Record<string, IndexEntry>,
): void {
  const issuesByExtid = new Map<string, GitIssue[]>();
  for (const [, issue] of gitIssues) {
    if (!issue.extid) continue;
    const list = issuesByExtid.get(issue.extid) ?? [];
    list.push(issue);
    issuesByExtid.set(issue.extid, list);
  }

  const indexExtids = new Set(Object.keys(index).map((k) => k.toUpperCase()));

  const seenTicketExtids = new Set<string>();
  const extidSlug = (extid: string): string =>
    extid.replace(/^(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)-/i, "")
      .toLowerCase();
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    if (seenTicketExtids.has(extid)) continue; // same extid in tickets+epics → manual
    seenTicketExtids.add(extid);
    const issueList = issuesByExtid.get(extid) ?? [];

    if (issueList.length === 0) {
      // Importable only if the ticket claims no live issue elsewhere: an
      // index entry pointing at an existing issue (even under a different
      // extid) means this is a mismatch/relink case, not a missing import —
      // creating a fresh issue would fork the ticket.
      const entry = index[extid];
      const claimsLiveIssue = [entry?.hash, entry?.git_issue].some(
        (h) => h !== undefined && h !== "pending" && gitIssues.has(h),
      );
      if (tf.gitIssue && !gitIssues.has(tf.gitIssue)) {
        report.danglingMdRefs.push({ extid, hash: tf.gitIssue });
      } else if (claimsLiveIssue) {
        // covered by hashMismatches / missingGitIssueLinks categories
      } else {
        report.importableTickets.push({ extid, title: tf.title, source: tf.source });
      }
      continue;
    }

    const openIssues = issueList.filter((i) => i.status === "open");
    if (openIssues.length >= 2) {
      report.duplicateOpenIssues.push({ extid, hashes: openIssues.map((i) => i.hash) });
      continue; // ambiguous: never auto-import/relink/dedupe
    }
  }

  // Dangling .md refs for tickets that DO have a matching issue (ref points
  // at a stale/removed hash). Manual: relink by hand or clear the line.
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    if (!tf.gitIssue || gitIssues.has(tf.gitIssue)) continue;
    if ((issuesByExtid.get(extid) ?? []).length > 0) {
      report.danglingMdRefs.push({ extid, hash: tf.gitIssue });
    }
  }

  // Title drift: the ticket was reclassified or moved (TASK-x.md → BUG-x.md)
  // but the registry issue still carries the old extid prefix. Slug-equal
  // (TYPE-prefix-insensitive) and unclaimed by any other .md → fixable.
  const claimedIssueHashes = new Set<string>();
  for (const tf of ticketFiles) {
    if (tf.gitIssue) claimedIssueHashes.add(tf.gitIssue);
  }
  for (const [, entry] of Object.entries(index)) {
    if (entry.git_issue) claimedIssueHashes.add(entry.git_issue);
  }
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    if ((issuesByExtid.get(extid) ?? []).length > 0) continue; // own issue exists
    const slug = extidSlug(extid);
    if (!slug) continue;
    for (const [hash, issue] of gitIssues) {
      if (!issue.extid || extidSlug(issue.extid) !== slug) continue;
      if (claimedIssueHashes.has(hash)) continue;
      report.titleDrifts.push({
        extid,
        hash,
        issueExtid: issue.extid,
        issueTitle: issue.title,
      });
      break; // one drift candidate per ticket; further matches are duplicates
    }
  }

  // Foreign issues: open, parsable extid, but neither a .md file nor an index
  // entry claims that extid anywhere — registry work not reflected in .plan/.
  for (const [, issue] of gitIssues) {
    if (issue.status !== "open") continue;
    if (claimedIssueHashes.has(issue.hash)) continue;
    if (!issue.extid) {
      report.foreignUnparsedIssues.push({ hash: issue.hash, title: issue.title });
      continue;
    }
    const hasFile = ticketFiles.some(
      (tf) => tf.filename.replace(/\.md$/, "").toUpperCase() === issue.extid,
    );
    if (hasFile || indexExtids.has(issue.extid)) continue;
    report.foreignIssues.push({ hash: issue.hash, extid: issue.extid, title: issue.title });
  }
}

// 11. .md Status drift: the index is authoritative for DONE-NESS only.
//     Git issues are binary (open/closed) while .md files carry the plan
//     vocabulary (6 terms), so a value difference between two non-done
//     states ("open" vs "In Progress") is not drift — rewriting it would
//     erase the vocabulary that `plan validate --fix` normalizes to and
//     the two fixers would oscillate. Flag only when the done
//     classification disagrees while the linked issue agrees with the
//     index (or there is no linked issue).
export function checkMdStatusDrift(
  report: SyncReport,
  index: Record<string, IndexEntry>,
  gitIssues: Map<string, GitIssue>,
  fileByExtid: Map<string, TicketFile>,
): void {
  for (const [extid, entry] of Object.entries(index)) {
    if (!entry.status) continue; // nothing authoritative recorded yet
    const indexStatus = normalizeStatus(entry.status);
    if (!indexStatus || indexStatus === "undefined") continue;
    const tf = fileByExtid.get(extid);
    if (!tf) continue;
    const mdStatus = normalizeStatus(tf.status);
    const mdDone = mdStatus === "done";
    const idxDone = indexStatus === "done";
    if (mdDone === idxDone) continue;
    const issue = entry.git_issue ? gitIssues.get(entry.git_issue) : undefined;
    let doneMdOpenIssue = false;
    if (issue) {
      const issueStatus = issue.status === "open" ? "open" : "done";
      // A done .md beside a lagging non-done index and a still-open issue is
      // NOT a manual three-way conflict: the done marker outranks the stale
      // index, and indexStatusStale's fix closes the open issue in the same
      // pass. Everything else stays manual.
      doneMdOpenIssue = mdDone && !idxDone && issueStatus === "open";
      if (issueStatus !== indexStatus && !doneMdOpenIssue) continue;
    }
    if (mdDone) {
      // .md done-classified but the index lags behind: the done marker
      // outranks the stale index — flip the index (and close a still-open
      // linked issue in the same pass).
      report.indexStatusStale.push({ extid, indexStatus, source: tf.source });
    } else {
      // Index done but the .md is not: rewrite every .md Status line to the
      // plan-vocabulary canonical "Done" — never the binary mirror value.
      report.mdStatusStale.push({
        extid,
        mdStatus: tf.status,
        indexStatus,
        source: tf.source,
      });
    }
  }
}

// 9. Advisory: non-epic index entries not bound to any epic. Never gates
//    the sync result (excluded from totalIssues and advisoryCount alike)
//    — informational only, mirroring checkLinkage's warn-level finding.
export function checkUnboundEpics(
  report: SyncReport,
  index: Record<string, IndexEntry>,
): void {
  for (const [extid, entry] of Object.entries(index)) {
    if (entry.type?.toUpperCase() === "EPIC") continue;
    if (entry.epic && entry.epic !== "") continue;
    report.unboundEpics.push(extid);
  }
}
