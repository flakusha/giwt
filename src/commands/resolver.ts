// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { parseTicketExtid } from "../tickets/sync-registry";
import { gitSync } from "../utils/git";

/** kebab() in commands/ticket/create.ts caps the title slug at 60 chars. A
 *  pasted needle shorter than that is a different id, never a truncation. */
const SLUG_CAP = 60;

export interface ResolvedIssue {
  hash: string;
  raw: string;
}

/**
 * Extract the extid from a git-issue title using the shared sync grammar.
 * Accepts both `<EXTID>: <prose>` (ticket creation) and bare registry titles;
 * returns null for foreign issues without a recognized extid prefix. The
 * matched text keeps the title's casing so callers can strip it verbatim.
 */
export function extractExtid(title: string): string | null {
  return parseTicketExtid(title);
}

export interface StatusStyle {
  /** Canonical vocabulary name (src/plan/status-vocab.ts). */
  name: string;
  glyph: string;
  color: "green" | "yellow" | "red" | "dim";
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  "Not Started": { name: "Not Started", glyph: "○", color: "dim" },
  "In Progress": { name: "In Progress", glyph: "🚧", color: "yellow" },
  "Blocked": { name: "Blocked", glyph: "⛔", color: "red" },
  "Done": { name: "Done", glyph: "✅", color: "green" },
  "Wontfix": { name: "Wontfix", glyph: "🗑", color: "dim" },
  "Postponed": { name: "Postponed", glyph: "⏸", color: "dim" },
  "duplicate-of": { name: "duplicate-of", glyph: "➡️", color: "dim" },
};

/**
 * Map a raw state value to badge/glyph style. git-issue states are
 * open/closed; plan-vocabulary names pass through unchanged. Unknown
 * values fall back to the neutral Not Started style.
 */
export function statusStyle(state: string): StatusStyle {
  if (state === "open") return STATUS_STYLES["Not Started"]!;
  if (state === "closed") return STATUS_STYLES["Done"]!;
  if (state.startsWith("duplicate-of")) return STATUS_STYLES["duplicate-of"]!;
  return STATUS_STYLES[state] ?? STATUS_STYLES["Not Started"]!;
}

export function resolveExtid(repoRoot: string, input: string): ResolvedIssue | null {
  // Agents paste the .plan/tickets/<slug>.md filename they see on disk;
  // strip the suffix so the filename form resolves like the bare slug
  // (TASK-show-state-resolve-plan-tickets-filename-slugs).
  const stripped = input.replace(/\.md$/i, "");
  // Extids are case-insensitive: `giwt ticket TASK my-title` creates the
  // lowercase kebab extid TASK-my-title, and lookups must round-trip it.
  const extidPattern = /^[a-z]+-[a-z0-9-]+$/i;
  if (!extidPattern.test(stripped)) {
    // Hash passthrough (BUG-ticket-id-inputs-): the stripped form is what
    // callers match hashes with — a pasted `40464b1.md` must not leak the
    // suffix into the hash.
    return { hash: stripped, raw: input };
  }

  const lines = gitSync(repoRoot, "issue", "ls", "--all").split("\n");
  const needle = stripped.toLowerCase();
  // Only a needle at the kebab() slug cap can be a truncated extid; shorter
  // needles are distinct ids, so TASK-alpha cannot resolve to TASK-alphabet.
  const mayBeTruncated = needle.length >= SLUG_CAP;
  const candidates = new Map<string, ResolvedIssue>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/([0-9a-f]{7,40})\s+/);
    const hash = match?.[1];
    if (!hash) continue;
    const resolved = { hash, raw: trimmed };
    // Exact extid wins over substring: a TASK-alpha line sorted ahead of
    // TASK-alphabet must not capture the latter's lookups.
    const title = trimmed.slice(match[0].length).replace(/^\[[^\]]*\]\s*/, "");
    const extid = extractExtid(title)?.toLowerCase();
    if (extid === needle) return resolved;
    // Fallback for truncated slugs only: match the title's leading extid
    // token, never prose mentioning the id. Collect every candidate so a
    // prefix shared by two issues stays ambiguous instead of picking one.
    if (mayBeTruncated && extid !== undefined && extid.startsWith(needle)) {
      candidates.set(extid, resolved);
    }
  }

  return candidates.size === 1 ? [...candidates.values()][0]! : null;
}

/**
 * Inverse of resolveExtid for hash-form input (BUG-ticket-id-inputs-):
 * walk the registry for the issue whose hash starts with the pasted
 * prefix and return its title extid. Null for non-hex input, unknown
 * hashes, and environments without the git-issue CLI — callers fall
 * through to their own unknown-ticket errors, so a swallowed git
 * failure only costs the hash form, never masks a real match.
 */
export function extidForHash(repoRoot: string, input: string): string | null {
  if (!/^[0-9a-f]{7,40}$/.test(input)) return null;
  let lines: string[];
  try {
    lines = gitSync(repoRoot, "issue", "ls", "--all").split("\n");
  } catch {
    return null;
  }
  for (const line of lines) {
    const match = line.match(/([0-9a-f]{7,40})\s+/);
    if (match?.[1] && match[1].startsWith(input)) {
      // extractExtid anchors at the title start; ls lines lead with the
      // hash and a `[state]` marker, so match against the title only.
      return extractExtid(line.slice(match[0].length).replace(/^\[[^\]]*\]\s*/, ""));
    }
  }
  return null;
}
