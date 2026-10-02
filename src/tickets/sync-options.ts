// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Public option/summary contracts for the ticket-index sync
 * (`runSync`). Kept in their own module so fix passes and the
 * run shell can share them without importing the shell itself.
 */

export interface SyncOptions {
  fix?: boolean;
  verbose?: boolean;
  /** Tickets dir relative to root; default ".plan/tickets" (settings.paths.tickets). */
  ticketsPath?: string;
  /**
   * With `--fix`: additionally create registry issues for plan files that
   * have none (`.md` → `git issue create` + link). Opt-in because mass
   * import on a repo full of plan-only files recreates the orphan-flood
   * failure mode (see BUG-plan-sync-fix-creates-orphan-git-issues); plain
   * `--fix` only reports them as importable tickets.
   */
  import?: boolean;
  /**
   * With `--fix`: additionally import foreign registry issues back into
   * `.plan/` — generate `.md` + index entry for each open issue whose extid
   * has no plan file and no index entry. Off by default because import-back
   * can resurrect tickets that were deliberately deleted; explicit opt-in.
   */
  importBack?: boolean;
  /** Called once with the final counts when a scan ran to completion
   *  (dry-run or fix mode, any exit code). Not called on early refusals
   *  (missing tickets dir, --fix lock/CLI refusal). */
  onSummary?: (summary: SyncSummary) => void;
  /** Ceiling for the `git issue ls --all` registry walk. Defaults to
   *  ISSUE_LS_TIMEOUT_MS (60s); exposed so tests can exercise the
   *  timed-out-vs-unavailable distinction without a real 60s sleep. */
  issueLsTimeoutMs?: number;
}

/** Final ticket-sync counts, for run-record outcome summaries. */
export interface SyncSummary {
  /** Ticket .md files scanned. */
  tickets: number;
  /** Automatic fixes applied to the index (0 in dry-run). */
  fixesApplied: number;
  /** Actionable issues remaining after the run (drives the exit code). */
  issuesRemaining: number;
  /** Advisory (non-gating) findings remaining. */
  advisoryRemaining: number;
}
