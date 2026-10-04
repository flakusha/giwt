// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// ── Ticket .md parsing ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { resolveStatus } from "../plan/status-vocab";
import { normalizeStatus } from "./sync-normalize";
import type { TicketFile } from "./sync-ticket-types";

/**
 * One `**Status:**` / `**Status**:` line (colon inside or outside the bold;
 * `status = value` and list/quote prefixes accepted). Mirrors omp-plugins
 * find-work's STATUS_LINE_RE so giwt's index and /find-work's roster
 * classify the same files — including dual-status reconciliation stubs.
 */
export const STATUS_LINE_RE =
  /^\s*(?:[-*>]\s*)?(?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/i;
/**
 * Parse a ticket .md file into a TicketFile.
 *
 * Metadata fields (**Status:**, **Priority:**, **Epic:**, **Tags:**) are
 * matched against the header region (first 30 lines) only — whole-file
 * matching captured body prose into the epic field. The git-issue
 * reference is still matched against the whole file: applyFixes appends
 * it at the end of the file, beyond the header region.
 */
export function parseTicketFile(filePath: string, source?: string): TicketFile | null {
  try {
    return parseTicketText(readFileSync(filePath, "utf8"), filePath, source);
  } catch {
    return null;
  }
}

/**
 * Parse ticket text (same contract as {@link parseTicketFile}, but on an
 * in-memory string) — lets the rebase conflict resolver parse conflict
 * stages without materializing temp files.
 */
export function parseTicketText(
  ticketText: string,
  filePath: string,
  source?: string,
): TicketFile | null {
  try {
    const lines = ticketText.split("\n").slice(0, 30); // header region only
    const header = lines.join("\n");

    const filename = basename(filePath);

    // Extract title from first heading
    const titleMatch = lines.find((l) => l.startsWith("# "));
    const title = titleMatch?.replace(
      /^#\s+(?:TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE):\s*/i,
      "",
    ).trim()
      ?? filename.replace(/\.md$/, "");

    // Extract metadata fields (header region only — body prose mentioning
    // **Epic:**/**Tags:** must not pollute the index fields)
    const priorityMatch = header.match(/\*\*Priority:\*\*\s*(.+)/i);
    const epicMatch = header.match(/\*\*Epic:\*\*\s*(.+)/i);
    const tagsMatch = header.match(/\*\*Tags:\*\*\s*(.+)/);

    // Extract type from heading
    const typeMatch = titleMatch?.match(
      /^#\s+(TASK|FEAT|BUG|FIX|EPIC|SOL|INFRA|TEST|PERF|WIRE|IMPROVE)/i,
    );
    const type = typeMatch?.[1]?.toUpperCase() ?? guessType(filename);

    // Extract git issue reference (e.g. "git issue: abc1234" or "Issue: abc1234")
    const gitIssueMatch = ticketText.match(/(?:git.?issue|issue):\s*([a-f0-9]{7,})/i);

    // Normalize status — mirror omp-plugins find-work's planFileTicket
    // (BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick):
    // reconciled tickets can carry multiple status lines (legacy
    // `**Status:** Not Started → closed (duplicate)` + follow-up
    // `**Status**: duplicate-of-…`); ANY done-class line closes the ticket.
    // When none is done-class the FIRST line wins, preserving
    // in_progress/draft detection from the primary Status.
    const statusValues = lines
      .map((l) => STATUS_LINE_RE.exec(l)?.[1]?.trim() ?? "")
      .filter((v) => v.length > 0);
    const rawStatus = statusValues[0] ?? "undefined";
    const status = statusValues.some((v) => normalizeStatus(v) === "done")
      ? "done"
      : normalizeStatus(rawStatus);

    return {
      path: filePath,
      filename,
      title,
      status,
      statusValues,
      type,
      priority: priorityMatch?.[1]?.trim() ?? "medium",
      epic: epicMatch?.[1]?.trim() ?? "",
      tags: tagsMatch?.[1]?.split(",").map((t) => t.trim()).filter(Boolean) ?? [],
      hash: gitIssueMatch?.[1] ?? null,
      gitIssue: gitIssueMatch?.[1] ?? null,
      source: source ?? filePath,
    };
  } catch {
    return null;
  }
}

function guessType(filename: string): string {
  const prefix = filename.split("-")[0]?.toUpperCase();
  if (
    ["TASK", "FEAT", "BUG", "FIX", "EPIC", "SOL", "INFRA", "TEST", "PERF", "WIRE", "IMPROVE"]
      .includes(prefix ?? "")
  ) {
    return prefix!;
  }
  return "TASK";
}

/**
 * Map a raw git/index status value to a plan-vocabulary term for .md
 * Status-line rewrites. Both fix writers (statusMismatches, mdStatusStale)
 * share this single mapping so a binary mirror value ("open"/"done") can
 * never leak into a .md and re-break `plan validate`'s status-vocab gate.
 * Unresolvable freeform values pass through untouched (reclassify-nothing).
 */
export function vocabStatusTarget(status: string): string {
  const r = resolveStatus(status, {});
  return r.action === "invalid" ? status : r.value;
}
