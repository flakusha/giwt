// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { readFileSync } from "node:fs";

/**
 * Status vocabulary for the `giwt plan validate status-vocab` gate.
 *
 * Tickets must carry a `**Status:**` value from a small closed enum so that
 * tooling (feature matrix, doctor, ticket sync) can reason about work state
 * without parsing freeform prose. Freeform history is preserved via aliases:
 * known synonyms classify as "fixable" and rewrite to the canonical value,
 * unknown values are "invalid" and need human judgment. Reconciliation
 * done-markers (`duplicate[- ]of…` stubs) always pass through untouched.
 *
 * Pure logic — no process.exit / console I/O.
 */

/** The closed set of canonical ticket status values. */
export const STATUS_ENUM: readonly string[] = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Done",
  "Wontfix",
  "Postponed",
];

/** Built-in freeform → canonical aliases, always active. */
export const DEFAULT_STATUS_ALIASES: Record<string, string> = {
  "not started": "Not Started",
  "in-progress": "In Progress",
  "in progress": "In Progress",
  "open": "Not Started",
  "open (planning)": "Not Started",
  "closed": "Done",
  "complete": "Done",
  "completed": "Done",
  "cancelled": "Wontfix",
  "dropped": "Wontfix",
};

export type StatusAction = "valid" | "fixable" | "invalid";

export interface StatusResolution {
  /** Canonical target for "fixable"; the untouched input otherwise. */
  value: string;
  action: StatusAction;
}

/**
 * Mirror of sync-ticket normalizeStatus's prefix stripping: leading
 * emoji/symbol decoration ("⬜ Not Started") is ignored for matching but
 * kept in the raw input so a rewrite drops it.
 */
const LEADING_EMOJI_RE = /^[\s\p{Extended_Pictographic}\p{Symbol}]+/u;

/** `duplicate`-class lines are the reconciliation done-marker convention. */
const DUPLICATE_RE = /^duplicate([- ]of)?/i;

/**
 * Split a trailing balanced parenthetical off `s`: the group opened by the
 * last unbalanced `(` through the closing `)` at the end is the annotation
 * (any whitespace between core and group stays with the annotation, as the
 * previous `\s*\(...\)$` regex did). Returns null when `s` does not end
 * with a balanced trailing group or the group would leave an empty core.
 */
function splitTrailingAnnotation(
  s: string,
): [core: string, annotation: string] | null {
  if (!s.endsWith(")") || s.length < 2) return null;
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]!;
    if (c === ")") depth++;
    else if (c === "(") {
      depth--;
      if (depth === 0) {
        let ws = i;
        while (ws > 0 && /\s/.test(s[ws - 1]!)) ws--;
        if (ws === 0) return null;
        return [s.slice(0, ws), s.slice(ws)];
      }
    }
  }
  return null;
}

/**
 * Classify one raw Status value against the vocabulary.
 *
 * Order matters: duplicate markers first (never rewritten), then the exact
 * canonical spelling, then case-insensitive canonical, then alias lookup in
 * `{ ...DEFAULT_STATUS_ALIASES, ...aliases }`.
 */
export function resolveStatus(
  raw: string,
  aliases: Record<string, string>,
): StatusResolution {
  // scanHeaderStatusLines leaves a value's opening `**` in the value span
  // and its closing `**` in the line suffix. Treat that pair as decoration:
  // classify the undecorated core, then flag the decorated form "fixable" so
  // --fix can drop the stray bold. duplicate-of-* stays valid and untouched.
  const bold = /^\*\*([\s\S]*?)(?:\*\*)?$/.exec(raw);
  if (bold !== null) {
    const undecorated = bold[1] ?? "";
    const inner = resolveStatus(undecorated, aliases);
    if (inner.action === "invalid") return { value: raw, action: "invalid" };
    if (DUPLICATE_RE.test(undecorated.toLowerCase().replace(LEADING_EMOJI_RE, "").trim())) {
      return { value: raw, action: "valid" };
    }
    return { value: inner.value, action: "fixable" };
  }
  const stripped = raw.toLowerCase().replace(LEADING_EMOJI_RE, "").trim();

  if (DUPLICATE_RE.test(stripped)) return { value: raw, action: "valid" };

  const trimmed = raw.trim();
  if (STATUS_ENUM.includes(trimmed)) return { value: raw, action: "valid" };

  const canonical = STATUS_ENUM.find((s) => s.toLowerCase() === stripped);
  if (canonical !== undefined) return { value: canonical, action: "fixable" };

  const table: Record<string, string> = { ...DEFAULT_STATUS_ALIASES, ...aliases };
  const target = table[stripped];
  if (target !== undefined) return { value: target, action: "fixable" };

  // Annotation tolerance: "✅ Done (landed on master: ...)" — a resolvable
  // core followed by a trailing parenthetical. The annotation carries
  // signal (normalizeStatus never coerces freeform notes), so the rewrite
  // keeps it: "Done (landed on master: ...)". Full-string alias lookup
  // runs first, so table keys that themselves end in a parenthetical
  // ("open (planning)") still win. The trailing group is found with
  // balanced-paren counting, so nested parens inside the annotation
  // ("Done (fix ... process.exit(0) ...)") resolve too; unbalanced
  // trailing parens still fall through to invalid.
  const annotation = splitTrailingAnnotation(raw.trim());
  if (annotation !== null) {
    const [coreRaw, annotationText] = annotation;
    const core = resolveStatus(coreRaw, aliases);
    if (core.action === "fixable" || core.action === "valid") {
      if (core.action === "valid" && core.value === coreRaw) {
        return { value: raw, action: "valid" };
      }
      return { value: `${core.value}${annotationText}`, action: "fixable" };
    }
  }

  return { value: raw, action: "invalid" };
}

/**
 * Matches one `**Status:** <value>` header line — the same line shape
 * sync-index's STATUS_LINE_RE accepts — split into decoration prefix, value
 * span, and decoration suffix. Decoration is preserved verbatim; only the
 * value span is ever rewritten.
 */
const STATUS_LINE_PARTS_RE =
  /^(\s*(?:[-*>]\s*)?(?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*)(.+?)(\s*(?:\*\*)?\s*)$/i;

export interface StatusLineRewrite {
  /** The full line with the value span replaced by the canonical form. */
  line: string;
  /** The raw value as it appeared on the line. */
  raw: string;
  /** The canonical value it was rewritten to. */
  canonical: string;
}

/** One source line outside a fenced code block, with its 0-based index. */
export interface SourceLine {
  line: number;
  text: string;
}

/**
 * Source lines with fenced (``` / ~~~) code blocks removed, indices intact so
 * callers can rewrite exact lines. Shared by every Status reader — a
 * `**Status:**` in a fenced reproduction example is documentation, never
 * metadata.
 */
export function linesOutsideFences(lines: string[]): SourceLine[] {
  const out: SourceLine[] = [];
  let fenced = false;
  for (const [line, text] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) out.push({ line, text });
  }
  return out;
}

/**
 * Scan a ticket file's header region (first 30 lines) for Status lines,
 * skipping fenced code blocks. Returns 0-based line indices with the line
 * text and the extracted raw value span.
 */
export function scanHeaderStatusLines(
  path: string,
): Array<{ line: number; text: string; value: string; }> {
  const lines = linesOutsideFences(readFileSync(path, "utf8").split("\n"));
  const out: Array<{ line: number; text: string; value: string; }> = [];
  for (const { line, text } of lines) {
    if (line >= 30) break;
    const m = STATUS_LINE_PARTS_RE.exec(text);
    if (m) out.push({ line, text, value: m[2] ?? "" });
  }
  return out;
}

/**
 * Rewrite a fixable status value on one line to its canonical form, keeping
 * the surrounding `**Status:**` decoration intact. Returns null when the
 * line is not a status line or the value is valid/invalid — invalid values
 * need human judgment and are never auto-rewritten.
 */
export function rewriteStatusLine(
  line: string,
  aliases: Record<string, string>,
): StatusLineRewrite | null {
  const m = STATUS_LINE_PARTS_RE.exec(line);
  if (!m) return null;
  const prefix = m[1] ?? "";
  const raw = (m[2] ?? "").trim();
  let suffix = m[3] ?? "";
  if (raw.startsWith("**")) {
    // The value's opening `**` was stripped for classification; drop the
    // matching closing `**` from the suffix so --fix leaves no stray trailing bold.
    suffix = suffix.replace("**", "");
  }
  const { value, action } = resolveStatus(raw, aliases);
  if (action !== "fixable") return null;
  return { line: `${prefix}${value}${suffix}`, raw, canonical: value };
}
