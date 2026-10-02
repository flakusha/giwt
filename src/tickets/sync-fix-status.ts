// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Status-related fix passes for the ticket-index sync: index status
 * backfill, index↔git status mismatch, index lagging an appended .md
 * done-marker, and .md Status-line rewrite. Call order is owned by
 * `applyFixes` (sync-fixes.ts).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isolatedGitEnv } from "../utils/git";
import { appendRegistryDoneProvenance } from "./sync-md";
import { normalizeStatus } from "./sync-normalize";
import { vocabStatusTarget } from "./sync-parse";
import type { GitIssue, IndexEntry, SyncReport, TicketFile } from "./sync-ticket-types";

/** Backfill ticket `status` from the on-disk .md (Status: <state>) into
 * index entries that have none. Existing index entries are NEVER
 * overwritten here — once a status has been set (by this pass, by the
 * statusMismatches fix below, or by hand), the index is treated as
 * authoritative. This keeps the backfill idempotent and prevents
 * oscillation with the statusMismatches fix when the .md status text
 * uses a form `normalizeStatus` cannot reduce (e.g. "📝 Draft"
 * normalizes to "draft" while git is "done"). The 186 stale-open
 * bookkeeping gaps this unblocks are auto-corrected by the
 * statusMismatches pass once the index has a normalized status to
 * compare against. */
export function backfillStatuses(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  ticketFiles: TicketFile[],
): void {
  for (const tf of ticketFiles) {
    const extid = tf.filename.replace(/\.md$/, "").toUpperCase();
    const cur = fixed[extid];
    if (!cur) continue;
    if (cur.status !== undefined) continue;
    fixed[extid] = { ...cur, status: normalizeStatus(tf.status) };
    report.fixesApplied.push(
      `${extid}: backfilled status (was undefined) → "${normalizeStatus(tf.status)}"`,
    );
  }
}

/** Converge index status with the git-issue state in one pass: rewrite the
 * .md Status line too, so the post-fix re-scan does not re-surface it as a
 * new .md-status fix. Route the raw git state through the shared vocabulary
 * mapping — the .md carries plan-vocab terms, the index keeps the raw value. */
export function fixStatusMismatches(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  fileByExtid: Map<string, TicketFile>,
  repoRoot: string,
): void {
  for (const mismatch of report.statusMismatches) {
    const cur = fixed[mismatch.extid];
    if (cur) {
      fixed[mismatch.extid] = {
        ...cur,
        status: mismatch.gitStatus,
      };
      report.fixesApplied.push(
        `${mismatch.extid}: status ${mismatch.indexStatus} → ${mismatch.gitStatus}`,
      );
      const tf = fileByExtid.get(mismatch.extid);
      if (tf) {
        try {
          const text = readFileSync(tf.path, "utf8").replace(
            /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim,
            `$1${vocabStatusTarget(mismatch.gitStatus)}`,
          );
          writeFileSync(tf.path, text);
          // Same provenance contract as the mdStatusStale writer below:
          // a .md flipped to Done from registry state carries the close
          // evidence, never a bare Done.
          if (normalizeStatus(mismatch.gitStatus) === "done") {
            appendRegistryDoneProvenance(tf.path, repoRoot, cur.hash);
          }
        } catch {
          // non-fatal: index entry already corrected; .md fixed next run
        }
      }
    }
  }
}

/** Fix lagging index entries outranked by an appended .md done-marker
 * (reconciler convention: a later Status line is the newer state).
 * Flip the index to done and close the linked open issue in the same
 * pass — reconcile ran before the flip, so deferring to the
 * staleOpenGitIssues pass would burn an extra run. */
export function fixIndexStatusStale(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  gitIssues: Map<string, GitIssue>,
  repoRoot: string,
): void {
  for (const m of report.indexStatusStale) {
    const cur = fixed[m.extid];
    if (!cur) continue;
    fixed[m.extid] = { ...cur, status: "done" };
    report.fixesApplied.push(
      `${m.extid}: index status ${m.indexStatus} → done (appended .md marker)`,
    );
    if (cur.git_issue && gitIssues.get(cur.git_issue)?.status === "open") {
      try {
        execSync(
          `git issue state ${cur.git_issue} --close -m 'Auto-closed: appended .md marker marks ${m.extid} done'`,
          { timeout: 10_000, cwd: repoRoot, env: isolatedGitEnv() },
        );
        report.fixesApplied.push(`${m.extid}: closed git issue ${cur.git_issue}`);
      } catch {
        // non-fatal: the next run's staleOpenGitIssues pass closes it
      }
    }
  }
}

/** .md Status drift: rewrite EVERY header Status line to the
 * authoritative index done-state in plan-vocabulary canonical form
 * ("Done"). The index mirrors binary git-issue state (open/done); the
 * classification (sync-ticket §11) only routes index-done/.md-not-done
 * here, but the vocabulary mapping stays explicit so a raw mirror value
 * can never leak into a .md and re-break `plan validate`'s status-vocab
 * gate. Rewriting every line (not just the first) keeps an appended
 * line from re-diverging the any-done aggregate on the next scan. */
export function fixMdStatusStale(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  fileByExtid: Map<string, TicketFile>,
  repoRoot: string,
): void {
  for (const ms of report.mdStatusStale) {
    const tf = fileByExtid.get(ms.extid);
    if (!tf) continue;
    try {
      let text = readFileSync(tf.path, "utf8");
      const target = vocabStatusTarget(ms.indexStatus);
      text = text.replace(
        /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim,
        `$1${target}`,
      );
      writeFileSync(tf.path, text);
      report.fixesApplied.push(
        `${ms.extid}: .md status ${ms.mdStatus} → ${target}`,
      );
      // Provenance for registry-driven Done stamps
      // (BUG-sync-fix-stamps-ticket-done-without-provenance): a Done the
      // sync itself derives from the shared registry carries the close
      // evidence in the .md — never a bare Done.
      if (normalizeStatus(target) === "done") {
        try {
          appendRegistryDoneProvenance(tf.path, repoRoot, fixed[ms.extid]?.hash);
        } catch {
          // non-fatal: the status stamp itself already landed
        }
      }
    } catch (e) {
      report.fixesApplied.push(
        `${ms.extid}: FAILED to rewrite .md status: ${
          e instanceof Error ? e.message.split("\n")[0] : String(e)
        }`,
      );
    }
  }
}
