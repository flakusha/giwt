// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ticket-header conflict auto-resolution in the rebase loop
 * (FEAT-ticket-header-conflict-resolver-in-rebase-loop): when both conflict
 * stages of a ticket .md parse cleanly, the header is merged by rule —
 * done-wins on Status, tag union, git-issue ref append — and the merged
 * file is written and staged. Unparseable stages and non-ticket files stay
 * for manual resolution. Body conflicts resolve to OURS (the replayed
 * side); only the header fields are merged.
 */

import { normalizeStatus } from "../../tickets/sync-normalize";
import { parseTicketText, vocabStatusTarget } from "../../tickets/sync-parse";
import { log } from "../../utils/output";
import { atomicWrite, fromRoot, runGit, unmergedPaths } from "./git-io";

/** Same Status-line shape the sync fixers rewrite (fixMdStatusStale). */
const STATUS_REWRITE_RE = /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim;

/** Union of both sides' tag lists, ours first, duplicates dropped. */
function unionTags(ours: string[], theirs: string[]): string {
  const seen = new Set<string>();
  for (const tag of [...ours, ...theirs]) {
    seen.add(tag);
  }
  return [...seen].join(", ");
}

/**
 * Merge the two conflict stages of one ticket .md. Returns the merged
 * content, or null when the stages are unparseable (leave for manual).
 */
export function mergeTicketHeader(
  oursText: string,
  theirsText: string,
  path: string,
): string | null {
  const ours = parseTicketText(oursText, path);
  const theirs = parseTicketText(theirsText, path);
  if (ours === null || theirs === null) return null;

  // Done-wins: a done-class Status on either side closes the ticket.
  const winnerStatus =
    normalizeStatus(ours.status) === "done" || normalizeStatus(theirs.status) === "done"
      ? "done"
      : ours.status;

  let merged = oursText.replace(STATUS_REWRITE_RE, `$1${vocabStatusTarget(winnerStatus)}`);

  // Tag union: rewrite the Tags line to the union of both sides.
  const tagsUnion = unionTags(ours.tags, theirs.tags);
  if (tagsUnion.length > 0) {
    merged = merged.replace(/(\*\*Tags:\*\*\s*)(.*)$/im, `$1${tagsUnion}`);
  }

  // Issue-ref append: theirs carries a git-issue ref ours lacks.
  if (ours.gitIssue === null && theirs.gitIssue !== null) {
    merged = `${merged.replace(/\n+$/, "")}\n\n  issue: ${theirs.gitIssue}\n`;
  }

  return merged;
}

/**
 * Auto-resolve unmerged ticket .md files whose both stages parse: merge
 * the header by rule, keep ours' body, write and stage. Returns the
 * resolved paths; each is announced with a warn log.
 */
export function resolveTicketHeaderConflicts(root: string, ticketsPath: string): string[] {
  const resolved: string[] = [];
  const prefix = `${ticketsPath.replace(/\/$/, "")}/`;
  for (const path of unmergedPaths(root)) {
    if (!path.startsWith(prefix) || !path.endsWith(".md")) continue;
    const ours = runGit(root, "show", `:2:${path}`);
    const theirs = runGit(root, "show", `:3:${path}`);
    if (ours.exitCode !== 0 || theirs.exitCode !== 0) continue;
    const merged = mergeTicketHeader(ours.stdout, theirs.stdout, path);
    if (merged === null) continue;
    atomicWrite(fromRoot(root, path), merged);
    if (runGit(root, "add", "--", path).exitCode !== 0) continue;
    log("warn", `auto-resolved ${path}: ticket-header rule merge`);
    resolved.push(path);
  }
  return resolved;
}
