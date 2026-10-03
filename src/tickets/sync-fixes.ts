// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orchestrator for `--fix` mode: applies every fix pass against the index
 * in the exact order the original monolithic applyFixes used, so report
 * messages and re-scan results are byte-identical.
 */

import {
  addOrphanFiles,
  fixMissingGitIssueLinks,
  fixMissingHashes,
  fixPhantomSources,
  fixPlaceholderHashes,
  relinkClosedDuplicates,
} from "./sync-fix-index";
import {
  closeStaleOpenIssues,
  fixTitleDrifts,
  importBackIssues,
  importTickets,
} from "./sync-fix-issues";
import {
  backfillStatuses,
  fixIndexStatusStale,
  fixMdStatusStale,
  fixStatusMismatches,
} from "./sync-fix-status";
import type { SyncOptions } from "./sync-options";
import type { GitIssue, IndexEntry, SyncReport, TicketFile } from "./sync-ticket-types";

/** Shared scope the fix passes need from the runSync prelude (paths are
 * resolved once there so report and fix modes agree). */
export interface FixContext {
  repoRoot: string;
  /** Repo-relative plan-dir prefixes shared by reconcile (candidate search)
   *  and applyFixes (relocation + index `source` fields) — custom
   *  `ticketsPath` aware so report and fix modes agree. */
  ticketsPrefix: string;
  epicsPrefix: string;
  epicsDir: string;
  ticketsDir: string;
  /** Diff-scope extids (undefined = full run). Fix passes must never
   *  touch entries outside this set — scoped `--fix` is scoped. */
  scope?: Set<string> | undefined;
  opts: SyncOptions;
}

export function applyFixes(
  ctx: FixContext,
  index: Record<string, IndexEntry>,
  report: SyncReport,
  ticketFiles: TicketFile[],
  gitIssues: Map<string, GitIssue>,
): Record<string, IndexEntry> {
  const fixed = { ...index };
  const fileByExtid = new Map<string, TicketFile>();
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    fileByExtid.set(extid, tf);
  }

  backfillStatuses(fixed, report, ticketFiles, ctx.scope);
  fixStatusMismatches(fixed, report, fileByExtid, ctx.repoRoot);
  fixIndexStatusStale(fixed, report, gitIssues, ctx.repoRoot);
  fixMissingHashes(fixed, report);
  fixPlaceholderHashes(fixed, report, fileByExtid, gitIssues);
  fixPhantomSources(fixed, report, ctx);
  addOrphanFiles(fixed, report, fileByExtid, gitIssues, ctx.ticketsPrefix);
  fixMissingGitIssueLinks(fixed, report);
  relinkClosedDuplicates(fixed, report, gitIssues);

  if (ctx.opts.import) {
    importTickets(fixed, report, fileByExtid, ctx);
  }
  fixTitleDrifts(fixed, report, fileByExtid, ctx);
  fixMdStatusStale(fixed, report, fileByExtid, ctx.repoRoot);

  if (ctx.opts.importBack) {
    importBackIssues(fixed, report, ctx);
  }

  closeStaleOpenIssues(report, ctx.repoRoot);

  return fixed;
}
