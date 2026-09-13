// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure reconciliation logic for .plan/tickets/index.json sync.
 *
 * Kept free of process.exit / argv so it can be unit-tested (see
 * scripts/sync-ticket-index.test.ts). `reconcile` is parameterized by the
 * repo root and tickets dir so tests can point it at fixture directories.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────

export interface TicketFile {
  path: string;
  filename: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  epic: string;
  hash: string | null;
  gitIssue: string | null;
}

export interface GitIssue {
  hash: string;
  status: "open" | "closed" | "done";
  title: string;
  extid: string | null; // e.g. "TASK-006" from "TASK-006: Some title"
}

export interface IndexEntry {
  hash: string;
  commitHash?: string;
  extid: string;
  type: string;
  title: string;
  label: string;
  priority: string;
  epic: string;
  tags: string[];
  source: string;
  git_issue?: string;
  status?: string;
  closed_issue?: boolean;
}

export interface SyncReport {
  orphanFiles: string[];
  phantomEntries: string[];
  placeholderHashes: Array<{
    extid: string;
    indexHash: string;
    ticketTitle: string;
  }>;
  hashMismatches: Array<{
    extid: string;
    indexHash: string;
    gitTitle: string | null;
    gitStatus: string | null;
    ticketTitle: string;
  }>;
  statusMismatches: Array<{
    extid: string;
    indexStatus: string;
    gitStatus: string;
  }>;
  missingHashes: Array<{
    extid: string;
    ticketTitle: string;
    suggestedHash: string | null;
    suggestedTitle: string | null;
  }>;
  /** Index entries missing `git_issue` field but a matching git issue exists. */
  missingGitIssueLinks: Array<{
    extid: string;
    suggestedGitIssue: string;
    gitTitle: string;
  }>;
  /** Index entries marked done but linked git issue still open. */
  staleOpenGitIssues: Array<{
    extid: string;
    gitIssueHash: string;
    indexStatus: string;
  }>;
  /** Open git issues with no matching index entry by extid. */
  orphanGitIssues: Array<{
    hash: string;
    extid: string;
    title: string;
  }>;
  fixesApplied: string[];
}

// ── Git object helpers ─────────────────────────────────────────

/**
 * True if `ref` resolves to an existing git commit.
 * Used to distinguish a shipped-commit hash from a placeholder/no-op value.
 */
export function gitObjectExists(ref: string): boolean {
  if (!/^[0-9a-f]{7,40}$/.test(ref)) return false;
  try {
    execSync(`git cat-file -e ${ref}^{commit} 2>/dev/null`, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ── Reconcile ──────────────────────────────────────────────────

export function reconcile(
  ticketFiles: TicketFile[],
  gitIssues: Map<string, GitIssue>,
  index: Record<string, IndexEntry>,
  _verbose: boolean,
  root: string,
): SyncReport {
  const report: SyncReport = {
    orphanFiles: [],
    phantomEntries: [],
    placeholderHashes: [],
    hashMismatches: [],
    statusMismatches: [],
    missingHashes: [],
    missingGitIssueLinks: [],
    staleOpenGitIssues: [],
    orphanGitIssues: [],
    fixesApplied: [],
  };

  // Build lookup: filename → ticket file
  const fileByExtid = new Map<string, TicketFile>();
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    fileByExtid.set(extid, tf);
  }

  // 1. Check orphan files (file exists, not in index)
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    if (!index[extid]) {
      report.orphanFiles.push(tf.filename);
    }
  }

  // 2. Check phantom entries (index has entry, file missing)
  for (const [extid, entry] of Object.entries(index)) {
    // First honor entry.source verbatim against the repo root (may be
    // .plan/tickets/*.md or .plan/epics/*.md — never re-anchor it).
    if (entry.source && existsSync(join(root, entry.source))) {
      continue;
    }

    // Fall back to ticket-naming conventions under .plan/tickets/
    const candidates = [
      `.plan/tickets/${extid}.md`,
      `.plan/tickets/${extid.toLowerCase()}.md`,
      `.plan/tickets/TASK-${extid.toLowerCase()}.md`,
      `.plan/tickets/FEAT-${extid.toLowerCase()}.md`,
      `.plan/tickets/BUG-${extid.toLowerCase()}.md`,
    ].filter(Boolean);

    const found = candidates.some((src) => existsSync(join(root, src)));

    if (!found) {
      report.phantomEntries.push(extid);
    }
  }

  // 3. Check hash provenance: a stored hash is either a git-issue hash
  //    (reconciled against `git issue ls`), a shipped-commit hash
  //    (entry.commitHash — validated against the git object store), or a
  //    placeholder with no provenance. Only a hash that resolves to a git
  //    issue but mismatches its title is a hard mismatch; the rest are
  //    advisory.
  for (const [extid, entry] of Object.entries(index)) {
    if (!entry.hash || entry.hash === "pending") continue;

    // Shipped-commit hash — valid git commit, nothing to reconcile.
    if (entry.commitHash && gitObjectExists(entry.commitHash)) continue;

    const issue = gitIssues.get(entry.hash);
    if (!issue) {
      // Not a git issue. If it's a real git object it's a commit reference
      // stored in `hash` (legacy) — accept it; otherwise flag placeholder.
      const tf = fileByExtid.get(extid);
      if (gitObjectExists(entry.hash)) continue;
      report.placeholderHashes.push({
        extid,
        indexHash: entry.hash,
        ticketTitle: tf?.title ?? entry.title,
      });
      continue;
    }

    // Check if title matches (lenient: check if core words overlap)
    const indexTitleNorm = entry.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const issueTitleNorm = issue.title.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Remove common prefixes from issue title (e.g. "TASK-006: " or "FEAT-070: ")
    const issueTitleClean = issueTitleNorm.replace(
      /^(task|feat|bug|fix|epic|sol|infra)[-__]?\d+[:_s]*/i,
      "",
    );
    // Also try matching extid directly
    const extidNorm = extid.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Extract meaningful words from extid (skip common prefixes like "task", "feat", "epic")
    const extidWords = extid.toLowerCase()
      .replace(/^(task|feat|bug|fix|epic|sol|infra)[-__]/i, "")
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2);
    const issueWords = issueTitleClean.split(/[^a-z0-9]+/).filter(w => w.length > 2);

    // Count word overlap
    const overlap = extidWords.filter(w =>
      issueWords.some(iw => w === iw || w.includes(iw) || iw.includes(w))
    );

    // Check if titles share significant overlap (at least 10 chars)
    // Also accept if 2+ words overlap, or if the first significant word matches
    const titleMatch = indexTitleNorm.includes(issueTitleClean.slice(0, 15))
      || issueTitleClean.includes(indexTitleNorm.slice(0, 15))
      || indexTitleNorm.includes(issueTitleNorm.slice(0, 15))
      || issueTitleNorm.includes(indexTitleNorm.slice(0, 15))
      || issueTitleNorm.startsWith(extidNorm)
      || issueTitleClean.startsWith(extidNorm)
      || overlap.length >= 2
      || (overlap.length >= 1 && extidWords.length <= 3);

    if (!titleMatch) {
      report.hashMismatches.push({
        extid,
        indexHash: entry.hash,
        gitTitle: issue.title,
        gitStatus: issue.status,
        ticketTitle: entry.title,
      });
    }
  }

  // 4. Check status mismatches
  for (const [extid, entry] of Object.entries(index)) {
    if (!entry.hash || entry.hash === "pending") continue;

    const issue = gitIssues.get(entry.hash);
    if (!issue) continue;

    const indexStatus = normalizeStatus(entry.status ?? "undefined");
    const gitStatus = issue.status === "done"
      ? "done"
      : issue.status === "closed"
      ? "done"
      : issue.status;

    if (indexStatus !== gitStatus && gitStatus !== "open") {
      // Only flag if git issue is closed/done but index says otherwise
      report.statusMismatches.push({
        extid,
        indexStatus,
        gitStatus,
      });
    }
  }

  // 5. Find missing hashes (file has content, no hash, but matching git issue exists)
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    const entry = index[extid];

    if (entry?.hash && entry.hash !== "pending") continue; // already has hash
    if (tf.hash) continue; // file has hash, but index doesn't — handled by orphan check

    // Try to find matching git issue by title
    for (const [, issue] of gitIssues) {
      if (issue.extid === extid) {
        report.missingHashes.push({
          extid,
          ticketTitle: tf.title,
          suggestedHash: issue.hash,
          suggestedTitle: issue.title,
        });
        break;
      }
    }
  }

  // 6. Find missing git_issue links: index entries that have hash (commit) but
  //    no git_issue field, where a matching open git issue exists by extid.
  //    Build extid→issue lookup from git issues.
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

  // 7. Stale open git issues: index entry is done/closed but linked git_issue
  //    is still open.
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

  // 8. Orphan git issues: open git issues with no matching index entry by extid.
  const indexExtids = new Set(Object.keys(index).map(k => k.toUpperCase()));

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

  return report;
}

export function normalizeStatus(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("done") || lower.includes("complete") || lower.includes("closed")) {
    return "done";
  }
  if (lower.includes("progress") || lower.includes("wip")) return "in_progress";
  if (lower.includes("not started") || lower.includes("pending") || lower === "open") return "open";
  if (lower.includes("draft")) return "draft";
  if (lower.includes("cancelled")) return "cancelled";
  return raw; // keep as-is if unknown
}
