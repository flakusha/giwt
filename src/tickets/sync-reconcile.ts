// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

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
import { isolatedGitEnv } from "../utils/git";
import { normalizeStatus } from "./sync-normalize";
import {
  checkIssueLifecycleDrift,
  checkMdStatusDrift,
  checkMissingGitIssueLinks,
  checkOrphanGitIssues,
  checkStaleOpenGitIssues,
  checkUnboundEpics,
} from "./sync-reconcile-checks";
import { applyReportScope } from "./sync-scope";
import type { GitIssue, IndexEntry, SyncReport, TicketFile } from "./sync-ticket-types";

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

/**
 * Batch verdict for `refs` (each peeled with `^{commit}`) via one
 * `git cat-file --batch-check` spawn — replaces N per-ref `cat-file -e`
 * subprocesses in the hash-provenance loop. Verdicts come from stdout only:
 * `git` echoes each request line, so request N maps positionally to output
 * line N; anything ending in `missing` does not resolve to a commit.
 * Refs failing the hex pre-check are absent from the map (false by
 * gitObjectExists semantics); on spawn failure the map is empty and callers
 * fall back to per-ref `gitObjectExists`.
 */
export function batchCommitObjectExists(
  root: string,
  refs: Iterable<string>,
): Map<string, boolean> {
  const list = [...new Set(refs)].filter((ref) => /^[0-9a-f]{7,40}$/.test(ref));
  const verdicts = new Map<string, boolean>();
  if (list.length === 0) return verdicts;
  const input = `${list.map((ref) => `${ref}^{commit}`).join("\n")}\n`;
  const proc = Bun.spawnSync(["git", "cat-file", "--batch-check"], {
    cwd: root,
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "ignore",
    env: isolatedGitEnv(),
  });
  if (proc.exitCode !== 0) return verdicts;
  const lines = new TextDecoder().decode(proc.stdout).split("\n");
  for (const [i, ref] of list.entries()) {
    verdicts.set(ref, lines[i] !== undefined && !lines[i].endsWith("missing"));
  }
  return verdicts;
}

// ── Reconcile ──────────────────────────────────────────────────

export function reconcile(
  ticketFiles: TicketFile[],
  gitIssues: Map<string, GitIssue>,
  index: Record<string, IndexEntry>,
  _verbose: boolean,
  root: string,
  /** Diff-scope extids (uppercased stems of plan files changed vs the base).
   *  Unset = full scan. */
  scope?: Set<string>,
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
  //
  //    Object-existence checks are batched: one `cat-file --batch-check`
  //    spawn covers every distinct ref (task: 3074 spawns ≈ 6.9 s → 89 ≈ 77 ms
  //    on loop-lore); `gitObjectExists` is the per-ref fallback when the
  //    batch spawn fails.
  const hashRefs = Object.values(index).flatMap((entry) =>
    entry.commitHash && entry.hash ? [entry.commitHash, entry.hash] : [entry.hash]
  ).filter((h): h is string => !!h);
  const batched = batchCommitObjectExists(root, hashRefs);
  const objectExists = (ref: string): boolean => batched.get(ref) ?? gitObjectExists(ref);
  for (const [extid, entry] of Object.entries(index)) {
    if (!entry.hash || entry.hash === "pending") continue;

    // Shipped-commit hash — valid git commit, nothing to reconcile.
    if (entry.commitHash && objectExists(entry.commitHash)) continue;

    const issue = gitIssues.get(entry.hash);
    if (!issue) {
      // Not a git issue. If it's a real git object it's a commit reference
      // stored in `hash` (legacy) — accept it; otherwise flag placeholder.
      const tf = fileByExtid.get(extid);
      if (objectExists(entry.hash)) continue;
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
      .filter((w) => w.length > 2);
    const issueWords = issueTitleClean.split(/[^a-z0-9]+/).filter((w) => w.length > 2);

    // Count word overlap
    const overlap = extidWords.filter((w) =>
      issueWords.some((iw) => w === iw || w.includes(iw) || iw.includes(w))
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
    const gitStatus = issue.status === "open" ? issue.status : "done";

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

  checkMissingGitIssueLinks(report, index, gitIssues);
  checkStaleOpenGitIssues(report, index, gitIssues);
  checkOrphanGitIssues(report, index, gitIssues);
  checkIssueLifecycleDrift(report, ticketFiles, gitIssues, index);
  checkMdStatusDrift(report, index, gitIssues, fileByExtid);
  checkUnboundEpics(report, index);

  if (scope) applyReportScope(report, scope);
  return report;
}
