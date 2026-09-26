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
  // ("open (planning)") still win.
  const annotation = raw.trim().match(/^(.+?)(\s*\([^()]*\))$/s);
  if (annotation !== null) {
    const core = resolveStatus(annotation[1]!, aliases);
    if (core.action === "fixable" || core.action === "valid") {
      if (core.action === "valid" && core.value === annotation[1]) {
        return { value: raw, action: "valid" };
      }
      return { value: `${core.value}${annotation[2]}`, action: "fixable" };
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

/**
 * Scan a ticket file's header region (first 30 lines) for Status lines,
 * skipping fenced code blocks — a `**Status:**` inside a ```md reproduction
 * example is documentation, not metadata. Returns 0-based line indices with
 * the line text and the extracted raw value span.
 */
export function scanHeaderStatusLines(
  path: string,
): Array<{ line: number; text: string; value: string; }> {
  const lines = readFileSync(path, "utf8").split("\n").slice(0, 30);
  const out: Array<{ line: number; text: string; value: string; }> = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = STATUS_LINE_PARTS_RE.exec(text);
    if (m) out.push({ line: i, text, value: m[2] ?? "" });
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
  const suffix = m[3] ?? "";
  const { value, action } = resolveStatus(raw, aliases);
  if (action !== "fixable") return null;
  return { line: `${prefix}${value}${suffix}`, raw, canonical: value };
}
