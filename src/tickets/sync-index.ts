// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Sync .plan/tickets/index.json with ticket .md files and git issues.
 *
 * Reads:
 *   1. .plan/tickets/*.md — extract frontmatter (title, status, type, priority, epic, tags)
 *   2. git issue ls — build hash→issue lookup
 *   3. .plan/tickets/index.json — current index state
 *
 * Reports:
 *   - Orphan files (.md exists, not in index)
 *   - Phantom entries (index has entry, .md missing)
 *   - Hash mismatches (hash points to wrong/missing issue)
 *   - Status mismatches (index vs git issue disagree)
 *   - Missing hashes (ticket has no hash, but matching issue exists)
 *
 * Usage:
 *   giwt sync              # dry-run report
 *   giwt sync --fix        # write fixes to index.json
 *   giwt sync --verbose    # show all entries
 *
 * --fix also resolves placeholder hashes (index hash with no git-issue /
 * commit provenance) by linking to a matching git issue (by extid). If no
 * matching issue exists, the placeholder is left in place (not mass-created
 * as a git issue — see BUG-plan-sync-fix-creates-orphan-git-issues).
 *
 * Layout (this file is the public shell — every historical import path
 * `./sync-index` keeps working):
 *   - sync-parse.ts        STATUS_LINE_RE / parseTicketFile / vocabStatusTarget
 *   - sync-options.ts      SyncOptions / SyncSummary
 *   - sync-md.ts           .md provenance stamps + issue-ref writer
 *   - sync-lock.ts         --fix mkdir lock
 *   - sync-registry.ts     `git issue ls` reader + index.json reader
 *   - sync-report.ts       report rendering + actionable/advisory counts
 *   - sync-fixes.ts        applyFixes orchestrator
 *   - sync-fix-{status,index,issues}.ts  individual fix passes
 */

import { existsSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { log, raw } from "../utils/output";
import { applyFixes } from "./sync-fixes";
import { acquireFixLock, releaseFixLock } from "./sync-lock";
import { type SyncOptions } from "./sync-options";
import { parseTicketFile } from "./sync-parse";
import { logFixRefusal, readGitIssues, readIndex } from "./sync-registry";
import { countIssueTotals, renderReport } from "./sync-report";
import { scopedPlanExtids } from "./sync-scope";
import { reconcile } from "./sync-ticket";
import type { IndexEntry, TicketFile } from "./sync-ticket-types";

export type { SyncOptions, SyncSummary } from "./sync-options";
export { parseTicketFile, STATUS_LINE_RE, vocabStatusTarget } from "./sync-parse";

/**
 * Run the ticket-index sync against `root` (the managed repo).
 * Returns the process exit code: 0 when in sync (or fixes resolved
 * everything), 1 when actionable issues remain or the run was refused.
 */
export function runSync(repoRoot: string, opts: SyncOptions = {}): number {
  const fixMode = opts.fix ?? false;
  const verbose = opts.verbose ?? false;
  const TICKETS_DIR = resolve(repoRoot, opts.ticketsPath ?? ".plan/tickets");
  const INDEX_PATH = join(TICKETS_DIR, "index.json");
  /** Serializes concurrent `--fix` runs (mkdir-based lock: atomic on POSIX). */
  const LOCK_PATH = join(TICKETS_DIR, ".index-sync.lock");
  const epicsDir = resolve(repoRoot, ".plan/epics");
  /** Repo-relative plan-dir prefixes shared by reconcile (candidate search)
   *  and applyFixes (relocation + index `source` fields) — custom
   *  `ticketsPath` aware so report and fix modes agree. */
  const ticketsPrefix = relative(repoRoot, TICKETS_DIR);
  const epicsPrefix = relative(repoRoot, epicsDir);

  /** Ceiling for the registry walk (opts override → test injection). */
  const issueLsTimeoutMs = opts.issueLsTimeoutMs ?? 60_000;

  // Diff-scope: when a base ref is set, only plan files changed vs that ref
  // gate the run (committed diff + dirty + untracked). A failed git query
  // (e.g. an unknown ref) must fail closed — widening to a full scan would
  // reintroduce the sibling-worktree false failures the scope exists to prevent.
  let scope: Set<string> | undefined;
  if (opts.diffBase) {
    const scoped = scopedPlanExtids({
      repoRoot,
      diffBase: opts.diffBase,
      ticketsPrefix,
      epicsPrefix,
    });
    if (scoped === null) {
      log(
        "error",
        `Ticket sync: refusing to run — diff base '${opts.diffBase}' is unreadable `
          + `(falling back to a full scan would report other sessions' tickets).`,
      );
      return 1;
    }
    scope = scoped;
  }

  // Read sources
  if (!existsSync(TICKETS_DIR)) {
    log("error", String(`Tickets directory not found: ${TICKETS_DIR}`).replace(/\n$/, ""));
    return 1;
  }

  const mdFiles = readdirSync(TICKETS_DIR).filter(
    (f) =>
      f.endsWith(".md") && /^(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)-/i.test(f),
  );

  // Epics live in a sibling dir (.plan/epics) with the same filename
  // conventions; scan it so epic files take part in every reconciliation
  // pass (import, adoption, phantom checks) instead of being invisible.
  const EPICS_DIR = resolve(repoRoot, ".plan/epics");
  const epicFiles = existsSync(EPICS_DIR)
    ? readdirSync(EPICS_DIR).filter(
      (f) =>
        f.endsWith(".md")
        && /^(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)-/i.test(f),
    )
    : [];

  const scanTicketFiles = (): TicketFile[] => {
    const files: TicketFile[] = [];
    for (const [dir, list] of [[TICKETS_DIR, mdFiles], [EPICS_DIR, epicFiles]] as const) {
      for (const f of list) {
        const tf = parseTicketFile(join(dir, f), relative(repoRoot, join(dir, f)));
        if (tf) files.push(tf);
      }
    }
    return files;
  };

  const ticketFiles: TicketFile[] = scanTicketFiles();

  const {
    issues: gitIssues,
    available: gitIssuesAvailable,
    reason: gitIssueFailReason,
    detail: gitIssueFailDetail,
  } = readGitIssues(repoRoot, issueLsTimeoutMs);
  const index = readIndex(INDEX_PATH);

  raw(`\n📊 Scanning...`);
  raw(`   Ticket .md files:  ${ticketFiles.length}`);
  raw(
    `   Git issues:        ${gitIssues.size}${
      gitIssuesAvailable
        ? ""
        : gitIssueFailReason === "timeout"
        ? ` (git issue ls timed out after ${issueLsTimeoutMs / 1000}s)`
        : gitIssueFailReason === "missing"
        ? " (git executable not found)"
        : ` (git issue ls failed${gitIssueFailDetail ? ` — ${gitIssueFailDetail}` : ""})`
    }`,
  );
  raw(`   Index entries:     ${Object.keys(index).length}`);

  // Reconcile — scope filters every extid-keyed category inside reconcile
  // (single filtering point: renderReport/countIssueTotals see the filtered
  // report directly).
  const report = reconcile(ticketFiles, gitIssues, index, verbose, repoRoot, scope);

  // Importable is the one category that INVERTS on an unreadable registry:
  // an empty map is indistinguishable from a missing tool, so plan-only
  // files must not be reported (nor trigger the --fix refusal below) when
  // the registry state is unknown. Issue-derived categories are naturally
  // empty in that case and need no gating.
  if (!gitIssuesAvailable) {
    report.importableTickets = [];
  }

  // Report
  renderReport(report, verbose);

  // Summary — only *actionable* issues gate the result. Placeholder hashes,
  // missing-hash suggestions, missing git_issue links, and orphan git issues
  // are advisory (yellow), not failures.  Stale open git issues are actionable.
  const { total: totalIssues, advisory: advisoryCount } = countIssueTotals(report);

  raw(`\n${"═".repeat(60)}`);

  // Apply fixes (also when only advisory issues exist — e.g. missing-hash
  // links, or a pending status backfill that no other category surfaces).
  const backfillPending = ticketFiles.some((tf) => {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    if (scope && !scope.has(extid)) return false;
    return index[extid]?.status === undefined;
  });
  if (fixMode && (totalIssues > 0 || advisoryCount > 0 || backfillPending)) {
    // With the issue registry unreadable, every non-commit hash looks like a
    // placeholder — --fix would mass-create issues. Refuse instead.
    if (!gitIssuesAvailable) {
      logFixRefusal(gitIssueFailReason, gitIssueFailDetail, issueLsTimeoutMs);
      return 1;
    }

    if (!acquireFixLock(LOCK_PATH)) {
      return 1;
    }
    let fixedIndex: Record<string, IndexEntry>;
    try {
      raw(`\n🔧 Applying fixes...`);
      fixedIndex = applyFixes(
        { repoRoot, ticketsPrefix, epicsPrefix, epicsDir, ticketsDir: TICKETS_DIR, scope, opts },
        index,
        report,
        ticketFiles,
        gitIssues,
      );

      // Sort by extid
      const sorted = Object.fromEntries(
        Object.entries(fixedIndex).sort(([a], [b]) => a.localeCompare(b)),
      );

      // Atomic write: temp file + rename, so a crash mid-write cannot
      // truncate index.json.
      const tmpPath = `${INDEX_PATH}.tmp-${process.pid}`;
      writeFileSync(tmpPath, JSON.stringify(sorted, null, 2) + "\n");
      renameSync(tmpPath, INDEX_PATH);
    } finally {
      // Never leak the lock on a failed fix run.
      releaseFixLock(LOCK_PATH);
    }
    raw(`Wrote ${INDEX_PATH}`);

    if (report.fixesApplied.length > 0) {
      raw(`\nChanges:`);
      report.fixesApplied.forEach((f) => raw(`   ${f}`));
    }

    // Recompute reconciliation on the *fixed* index so the summary reflects
    // the resolved state (e.g. placeholder hashes now linked, not still
    // advisory). The registry is re-read too: import/rename fixes changed
    // it, and a stale map would re-report resolved tickets as importable.
    const refreshed = readGitIssues(repoRoot, issueLsTimeoutMs);
    const postGitIssues = refreshed.available ? refreshed.issues : gitIssues;
    // Re-scan .md files too: fixes may have rewritten Status lines or
    // generated import-back files; reconciling against stale in-memory
    // copies would re-report what the fix just resolved.
    const postTicketFiles = scanTicketFiles();
    const postReport = reconcile(
      postTicketFiles,
      postGitIssues,
      fixedIndex,
      verbose,
      repoRoot,
      scope,
    );
    const { total: postTotal, advisory: postAdvisory } = countIssueTotals(postReport);

    if (postTotal === 0) {
      raw(`Index is in sync${postAdvisory > 0 ? ` (${postAdvisory} advisory remaining)` : ""}`);
    } else {
      raw(
        `${postTotal} actionable issue(s) remain${
          postAdvisory > 0 ? `, ${postAdvisory} advisory` : ""
        }`,
      );
    }
    opts.onSummary?.({
      tickets: ticketFiles.length,
      fixesApplied: report.fixesApplied.length,
      issuesRemaining: postTotal,
      advisoryRemaining: postAdvisory,
    });
    return postTotal > 0 ? 1 : 0;
  }

  if (fixMode && totalIssues === 0) {
    raw(`\nNothing to fix`);
  } else if (totalIssues > 0) {
    raw(`\nRun with --fix to apply automatic fixes`);
  }

  if (totalIssues === 0) {
    raw(`Index is in sync${advisoryCount > 0 ? ` (${advisoryCount} advisory)` : ""}`);
  } else {
    raw(
      `${totalIssues} actionable issue(s) found${
        advisoryCount > 0 ? `, ${advisoryCount} advisory` : ""
      }`,
    );
  }

  opts.onSummary?.({
    tickets: ticketFiles.length,
    fixesApplied: 0,
    issuesRemaining: totalIssues,
    advisoryRemaining: advisoryCount,
  });

  // Exit code
  return totalIssues > 0 ? 1 : 0;
}
