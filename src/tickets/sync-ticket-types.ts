// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

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
   * .md Status does not classify done while the (authoritative-for-done-ness)
   * index does, and the linked issue agrees with the index. Fixable: rewrite
   * the .md line to the vocabulary canonical "Done" (never the binary mirror
   * value — that would erase the plan vocabulary).
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
