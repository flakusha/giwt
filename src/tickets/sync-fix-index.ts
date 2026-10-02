// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Index-entry fix passes for the ticket-index sync: hash repair
 * (missing/placeholder), phantom source relocation, orphan-file adoption,
 * git_issue link backfill, and closed→open relink. Call order is owned by
 * `applyFixes` (sync-fixes.ts).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FixContext } from "./sync-fixes";
import { appendIssueRef } from "./sync-md";
import { normalizeStatus } from "./sync-normalize";
import type { GitIssue, IndexEntry, SyncReport, TicketFile } from "./sync-ticket-types";

export function fixMissingHashes(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
): void {
  for (const missing of report.missingHashes) {
    const cur = fixed[missing.extid];
    if (cur) {
      fixed[missing.extid] = {
        ...cur,
        hash: missing.suggestedHash!,
      };
      report.fixesApplied.push(`${missing.extid}: added hash ${missing.suggestedHash}`);
    }
  }
}

/** Fix placeholder hashes: index hash points to no git issue and is not a
 * real commit (no provenance at all). Resolve by linking to a matching git
 * issue (by extid). If no matching issue exists, the placeholder is left
 * in place — mass-creating git issues for unprovenanced entries produced
 * orphan floods (see BUG-plan-sync-fix-creates-orphan-git-issues). */
export function fixPlaceholderHashes(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  fileByExtid: Map<string, TicketFile>,
  gitIssues: Map<string, GitIssue>,
): void {
  for (const ph of report.placeholderHashes) {
    const entry = fixed[ph.extid];
    if (!entry) continue;

    // 1. Try a matching git issue by extid.
    let target: GitIssue | undefined;
    for (const [, issue] of gitIssues) {
      if (issue.extid === ph.extid) {
        target = issue;
        break;
      }
    }

    // 2. Otherwise leave the placeholder as-is. Mass-creating git issues
    //    for unprovenanced index entries produced a flood of orphan issues
    //    (see BUG-plan-sync-fix-creates-orphan-git-issues); let the user
    //    open the issue explicitly when they're ready.
    if (!target) {
      report.fixesApplied.push(
        `${ph.extid}: SKIPPED placeholder fix — no matching git issue (orphan left in place)`,
      );
      continue;
    }

    // 3. Update the index entry.
    fixed[ph.extid] = {
      ...entry,
      hash: target.hash,
      git_issue: target.hash,
    };
    report.fixesApplied.push(
      `${ph.extid}: replaced placeholder ${ph.indexHash} → ${target.hash}`,
    );

    // 4. Update the .md file's git issue ref if present.
    const tf = fileByExtid.get(ph.extid);
    if (tf) {
      try {
        appendIssueRef(tf.path, target.hash);
        report.fixesApplied.push(`${ph.extid}: linked .md to git issue ${target.hash}`);
      } catch {
        // non-fatal: the index entry itself is already corrected
      }
    }
  }
}

/** Fix phantom entries by trying to find matching files with different names.
 * Search both `ticketsDir` (default `.plan/tickets/`, overridable via
 * `ticketsPath`) and the canonical `.plan/epics/` sibling dir (epics
 * live there with the same filename conventions). The earlier code
 * only searched `ticketsDir`, which left EPIC-* entries with their
 * `source` pinned to `.plan/tickets/epic-foo.md` while the actual
 * file lived in `.plan/epics/epic-foo.md` — see
 * TASK-plan-index-orphan-phantom-cleanup for the 297-phantom debt.
 * ticketsPrefix/epicsPrefix/epicsDir live in runSync scope — shared with
 * the reconcile call so report-only and fix modes see the same dirs. */
export function fixPhantomSources(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  ctx: FixContext,
): void {
  for (const extid of report.phantomEntries) {
    const entry = fixed[extid];
    if (!entry) continue;

    // Never re-anchor a distinct source (a custom external path, a file
    // on another branch/worktree, a temporary rename) to a guessed path —
    // only entries whose source is empty or already managed by this
    // sync (tickets/epics dirs) may be relocated.
    const src = entry.source ?? "";
    const managed = src === ""
      || src.startsWith(`${ctx.ticketsPrefix}/`)
      || src.startsWith(`${ctx.epicsPrefix}/`)
      || src.startsWith(".plan/tickets/"); // historical canonical sources
    if (!managed) continue;
    // Out-of-repo tickets dir → relative() yields `../…` garbage; never
    // write that into the index.
    if (ctx.ticketsPrefix.startsWith("..") || ctx.epicsPrefix.startsWith("..")) continue;

    const lc = extid.toLowerCase();
    const patterns: Array<{ dir: string; prefix: string; }> = [
      { dir: ctx.ticketsDir, prefix: ctx.ticketsPrefix },
      { dir: ctx.epicsDir, prefix: ctx.epicsPrefix },
    ];
    const fileNames = [
      `${extid}.md`,
      `${lc}.md`,
      `TASK-${lc}.md`,
      `FEAT-${lc}.md`,
      `BUG-${lc}.md`,
      `epic-${lc}.md`,
      `EPIC-${lc}.md`,
    ];

    let relocated = false;
    for (const { dir, prefix } of patterns) {
      for (const name of fileNames) {
        const filePath = join(dir, name);
        if (existsSync(filePath)) {
          fixed[extid] = {
            ...entry,
            source: `${prefix}/${name}`,
          };
          report.fixesApplied.push(
            `${extid}: fixed source path to ${prefix}/${name}`,
          );
          relocated = true;
          break;
        }
      }
      if (relocated) break;
    }
  }
}

/** Add orphan files to index (skip if source path already exists in any entry). */
export function addOrphanFiles(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  fileByExtid: Map<string, TicketFile>,
  gitIssues: Map<string, GitIssue>,
  ticketsPrefix: string,
): void {
  const existingSources = new Set(
    Object.values(fixed).map((e) => e.source?.toLowerCase()),
  );

  for (const filename of report.orphanFiles) {
    const extid = filename.replace(/\.md$/, "").toUpperCase();
    if (fixed[extid]) continue; // key already exists

    const sourcePath = `${ticketsPrefix}/${filename}`;
    if (existingSources.has(sourcePath.toLowerCase())) continue; // source already tracked

    const tf = fileByExtid.get(extid);
    if (!tf) continue;

    // Resolve the ticket's OWN git issue: authoritative registry lookup by
    // extid FIRST. tf.hash originates from an explicit "git issue:" line in
    // the .md and may be stale or absent — never trusted over the registry.
    let gitIssueHash: string | null = null;
    for (const [, issue] of gitIssues) {
      if (issue.status === "open" && issue.extid === extid) {
        gitIssueHash = issue.hash;
        break;
      }
    }
    // Fall back to the ticket's own "git issue:" reference only if it still
    // resolves to an OPEN issue — a closed/stale hash (or one no longer in
    // the registry) must not leak a dead git_issue link into the index.
    const fallback = tf.gitIssue;
    if (!gitIssueHash && fallback && gitIssues.get(fallback)?.status === "open") {
      gitIssueHash = fallback;
    }

    fixed[extid] = {
      hash: gitIssueHash ?? "pending",
      ...(gitIssueHash !== null ? { git_issue: gitIssueHash } : {}),
      extid,
      type: tf.type,
      title: tf.title,
      label: tf.type.toLowerCase(),
      priority: tf.priority,
      epic: tf.epic,
      tags: tf.tags,
      source: sourcePath,
      status: normalizeStatus(tf.status),
    };
    existingSources.add(sourcePath.toLowerCase());
    report.fixesApplied.push(`${extid}: added to index (from orphan file)`);
  }
}

export function fixMissingGitIssueLinks(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
): void {
  for (const m of report.missingGitIssueLinks) {
    const cur = fixed[m.extid];
    if (cur) {
      fixed[m.extid] = {
        ...cur,
        git_issue: m.suggestedGitIssue,
      };
      report.fixesApplied.push(`${m.extid}: added git_issue = ${m.suggestedGitIssue}`);
    }
  }
}

/** Relink entries whose hash points to a CLOSED issue when an OPEN
 * duplicate sharing the same extid exists (ticket was re-created; the old
 * issue was closed). Keeps index bound to the live issue. */
export function relinkClosedDuplicates(
  fixed: Record<string, IndexEntry>,
  report: SyncReport,
  gitIssues: Map<string, GitIssue>,
): void {
  for (const [extid, entry] of Object.entries(fixed)) {
    const cur = entry.hash ? gitIssues.get(entry.hash) : undefined;
    if (!cur || cur.status !== "closed") continue;
    let openDup: GitIssue | null = null;
    for (const [, issue] of gitIssues) {
      if (issue.status === "open" && issue.extid === extid) {
        openDup = issue;
        break;
      }
    }
    if (openDup) {
      fixed[extid] = { ...entry, hash: openDup.hash, git_issue: openDup.hash };
      report.fixesApplied.push(`${extid}: relinked closed ${cur.hash} → open ${openDup.hash}`);
    }
  }
}
