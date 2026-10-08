// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Repeated-line-runs scan — weave damage check 1 (FEAT-weave-damage-scan).
 *
 * The observed damage: one callback parameter line triplicated in place
 * plus 17 more copies appended at EOF — 20 occurrences of a signature that
 * exists exactly once. A merge resolution that concatenates or repeats a
 * region instead of choosing one side leaves exactly this shape, and it
 * still parses, typechecks and lints.
 *
 * No AST: count identical trimmed non-trivial lines. Trivial lines (short,
 * comment-only, punctuation-only closers) never count — that is what keeps
 * import lists, table-driven blocks and switch `break;` ladders silent.
 * Signal is ranked, not hard-failed: 2 occurrences is info, 3+ is warning,
 * and the rank grows with count and line length so a human triages the
 * loudest damage first.
 */

import type { AuditFinding } from "../types";

export const MIN_REPEATS_DEFAULT = 2;

/** Lines shorter than this are trivial by definition (closers, `break;`,
 * short guards) — legitimate repetition lives below this line. */
export const MIN_SIGNAL_LENGTH = 12;

const COMMENT_LINE_RE = /^(?:\/\/|\/\*|\*|#)/;
const PUNCTUATION_ONLY_RE = /^[)\]},;]+$/;

/** Occurrence line numbers listed in the count evidence before `+N more`. */
const MAX_LISTED_LINES = 30;

export interface RepeatScanOptions {
  text: string;
  path: string;
  /** Identical-line threshold (default 2 — configurable per repo). */
  minRepeats?: number;
}

interface RepeatRecord {
  line: string;
  lines: number[];
}

export function scanRepeats(
  { text, path, minRepeats = MIN_REPEATS_DEFAULT }: RepeatScanOptions,
): AuditFinding[] {
  const records = new Map<string, RepeatRecord>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (
      trimmed.length < MIN_SIGNAL_LENGTH
      || COMMENT_LINE_RE.test(trimmed)
      || PUNCTUATION_ONLY_RE.test(trimmed)
    ) {
      continue;
    }
    const record = records.get(trimmed) ?? { line: trimmed, lines: [] };
    record.lines.push(i + 1);
    records.set(trimmed, record);
  }
  const findings: AuditFinding[] = [];
  for (const { line, lines: at } of records.values()) {
    if (at.length < minRepeats) continue;
    const first = at[0] ?? 0;
    findings.push({
      detector: "weave",
      reason: "repeated-lines",
      severity: at.length >= 3 ? "warning" : "info",
      rank: Math.min(90, 20 + at.length * 6 + Math.floor(Math.min(line.length, 100) / 4)),
      message:
        `identical line repeated ${at.length} times — a merge resolution probably repeated a region`,
      paths: [path],
      evidence: [
        { kind: "line", path, start: first, end: first, content: line },
        { kind: "count", detail: `${at.length} occurrences at lines ${listLines(at)}` },
      ],
    });
  }
  return findings.sort((a, b) => b.rank - a.rank);
}

function listLines(at: readonly number[]): string {
  const listed = at.slice(0, MAX_LISTED_LINES).join(", ");
  return at.length > MAX_LISTED_LINES
    ? `${listed} (+${at.length - MAX_LISTED_LINES} more)`
    : listed;
}
