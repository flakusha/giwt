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
  /** Raw values of every Status line in the header; `status` is the
   * any-done aggregate (reconciler convention: appended lines are newer). */
  statusValues: string[];
  type: string;
  priority: string;
  epic: string;
  tags: string[];
  hash: string | null;
  gitIssue: string | null;
  /** Repo-relative source path (`.plan/tickets/x.md` or `.plan/epics/x.md`). */
  source: string;
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
  /**
   * Ticket/epic .md files with no git issue at all (no registry entry whose
   * extid matches, in any state). Fixable: `--fix` creates the issue
   * (`git issue create "<extid>: <title>"`) and links file + index.
   */
  importableTickets: Array<{
    extid: string;
    title: string;
    source: string;
  }>;
  /**
   * Open issues whose extid has no .md file and no index entry anywhere —
   * work that lives in the registry but is not reflected in `.plan/`.
   * Report-only by default; `--import-back` generates the .md + index entry.
   */
  foreignIssues: Array<{
    hash: string;
    extid: string;
    title: string;
  }>;
  /** Open issues with no parsable extid and no index/.md claim — manual. */
  foreignUnparsedIssues: Array<{
    hash: string;
    title: string;
  }>;
  /** Two or more OPEN issues sharing one extid — manual dedupe. */
  duplicateOpenIssues: Array<{
    extid: string;
    hashes: string[];
  }>;
  /** A .md `git issue: <hash>` reference resolving to no registry entry. */
  danglingMdRefs: Array<{
    extid: string;
    hash: string;
  }>;
  /**
   * Issue extid differs from the ticket's extid but the slug matches — the
   * ticket was reclassified/moved (e.g. TASK-x → BUG-x). Fixable via
   * `git issue edit <hash> -t`.
   */
  titleDrifts: Array<{
    extid: string;
    hash: string;
    issueExtid: string;
    issueTitle: string;
  }>;
  /**
   * .md Status line disagrees with the (authoritative) index status while the
   * linked issue agrees with the index. Fixable: rewrite the .md line.
   */
  mdStatusStale: Array<{
    extid: string;
    mdStatus: string;
    indexStatus: string;
    source: string;
  }>;
  /**
   * Multi-status .md whose any-done aggregate outranks a lagging index —
   * the reconciler's appended Status line is the newer state. Fixable:
   * flip the index to done (+ close the linked open issue in one pass).
   */
  indexStatusStale: Array<{
    extid: string;
    indexStatus: string;
    source: string;
  }>;
  /**
   * Advisory: non-epic index entries with no epic binding (extids).
   * Deliberately excluded from every gating/advisory count in runSync —
   * informational only, mirroring checkLinkage's warn-level finding.
   */
  unboundEpics: string[];
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
    importableTickets: [],
    foreignIssues: [],
    foreignUnparsedIssues: [],
    duplicateOpenIssues: [],
    danglingMdRefs: [],
    titleDrifts: [],
    mdStatusStale: [],
    indexStatusStale: [],
    unboundEpics: [],
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

    // Fall back to ticket-naming conventions under .plan/tickets/ and
    // .plan/epics/ (epics live in a sibling dir with the same filename
    // conventions — historical index entries may have their `source`
    // pinned to .plan/tickets/ even though the file was migrated to
    // .plan/epics/, so we have to look in both places).
    const lc = extid.toLowerCase();
    const candidates = [
      `.plan/tickets/${extid}.md`,
      `.plan/tickets/${lc}.md`,
      `.plan/tickets/TASK-${lc}.md`,
      `.plan/tickets/FEAT-${lc}.md`,
      `.plan/tickets/BUG-${lc}.md`,
      `.plan/epics/${extid}.md`,
      `.plan/epics/${lc}.md`,
      `.plan/epics/epic-${lc}.md`,
      `.plan/epics/EPIC-${lc}.md`,
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

  // 10. Issue-lifecycle drift (import / foreign / duplicate / move):
  //     keyed per extid across ALL issues (the lookups above stop at the
  //     first match, which hides duplicates and reclassified tickets).
  const issuesByExtid = new Map<string, GitIssue[]>();
  for (const [, issue] of gitIssues) {
    if (!issue.extid) continue;
    const list = issuesByExtid.get(issue.extid) ?? [];
    list.push(issue);
    issuesByExtid.set(issue.extid, list);
  }

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

  // 11. .md Status drift: the index is authoritative (existing fixes treat it
  //     so) — flag .md files whose Status line disagrees while the linked
  //     issue agrees with the index (or there is no linked issue).
  for (const [extid, entry] of Object.entries(index)) {
    if (!entry.status) continue; // nothing authoritative recorded yet
    const indexStatus = normalizeStatus(entry.status);
    if (!indexStatus || indexStatus === "undefined") continue;
    const tf = fileByExtid.get(extid);
    if (!tf) continue;
    const mdStatus = normalizeStatus(tf.status);
    if (mdStatus === indexStatus) continue;
    const issue = entry.git_issue ? gitIssues.get(entry.git_issue) : undefined;
    let doneMdOpenIssue = false;
    if (issue) {
      const issueStatus = issue.status === "open" ? "open" : "done";
      // A done .md beside a lagging non-done index and a still-open issue is
      // NOT a manual three-way conflict: the done marker outranks the stale
      // index, and indexStatusStale's fix closes the open issue in the same
      // pass. Everything else stays manual.
      doneMdOpenIssue = mdStatus === "done" && indexStatus !== "done" && issueStatus === "open";
      if (issueStatus !== indexStatus && !doneMdOpenIssue) continue;
    }
    if (
      (tf.statusValues.length > 1 && mdStatus === "done") || doneMdOpenIssue
    ) {
      report.indexStatusStale.push({ extid, indexStatus, source: tf.source });
    } else {
      report.mdStatusStale.push({
        extid,
        mdStatus: tf.status,
        indexStatus,
        source: tf.source,
      });
    }
  }

  // 9. Advisory: non-epic index entries not bound to any epic. Never gates
  //    the sync result (excluded from totalIssues and advisoryCount alike)
  //    — informational only, mirroring checkLinkage's warn-level finding.
  for (const [extid, entry] of Object.entries(index)) {
    if (entry.type?.toUpperCase() === "EPIC") continue;
    if (entry.epic && entry.epic !== "") continue;
    report.unboundEpics.push(extid);
  }

  return report;
}

export function normalizeStatus(raw: string): string {
  const lower = raw.toLowerCase();

  // `[OK] …` is a loop-lore convention marking an intentional freeform
  // note ("already documented in …", "already resolved in dev"). It must
  // pass through — reclassifying would lose the author's signal.
  if (/^\s*\[ok\]/i.test(raw)) return raw;

  // Strip leading emoji/symbol prefixes so that "✅ Resolved",
  // "🟡 Partial", "⬜ Open", "🟢 Partial (adopted …)" don't dominate
  // the match. Use Unicode property escapes so oxlint does not flag the
  // emoji class for combining characters. Brackets like `[OK]` are
  // NOT stripped here — they're freeform signal handled separately.
  const stripped = lower
    .replace(/^[\s\p{Extended_Pictographic}\p{Symbol}]+/u, "")
    .trim();

  // Specific negative — check before the done-regex so the substring
  // "implemented" inside "not-yet-implemented" doesn't dominate.
  if (/\bnot[- ]yet[- ]implemented\b/.test(stripped)) return "open";

  // Specific partials — check before done-regex so "Partially Implemented"
  // doesn't trip on the "implemented" keyword.
  if (
    /\b(partial|partially[- ]?(built|implemented|done)|foundation)\b/.test(stripped)
  ) return "in_progress";
  if (/\bwip\b|\bin[- ]progress\b/.test(stripped)) return "in_progress";

  // Resolved-class: any "resolved", "fixed", "implemented", "finished",
  // "shipped" — with or without trailing commit/date annotation.
  if (
    /\b(done|complete[d]?|closed|resolved|fixed|implemented|finished|shipped)\b/.test(stripped)
  ) return "done";
  // fixed-in-worktree is the loop-lore convention for a fix landed in a
  // branch that hasn't merged yet — treat as done for reconciliation.
  if (stripped.includes("fixed-in-worktree")) return "done";
  // Reconciliation markers: `duplicate-of-…` stubs are closed work —
  // mirrors omp-plugins find-work's STATUS_DONE_RE duplicate class so both
  // parsers close dual-status stubs identically.
  if (/\bduplicate([- ]of)?\b/.test(stripped)) return "done";

  // Open-class: explicit "open", "deferred", "todo", "research needed",
  // "follow-up".
  if (
    lower === "open" || stripped.startsWith("open")
    || /\b(deferred|todo|research[- ]needed|follow[- ]up)\b/.test(stripped)
  ) return "open";

  if (lower.includes("draft")) return "draft";
  if (lower.includes("cancelled") || lower.includes("canceled")) return "cancelled";

  // Pass-through: freeform notes ("not-a-bug", "[OK] documented in …",
  // "stale", "🔄 split into two tickets below", "🟡 permanently ongoing").
  // These are intentional state comments — reclassifying would lose signal.
  return raw;
}
