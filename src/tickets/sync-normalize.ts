// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

export function normalizeStatus(raw: string): string {
  const lower = raw.toLowerCase();

  // `[OK] …` is a loop-lore convention marking an intentional freeform
  // note ("already documented in …", "already resolved in dev"). It must
  // pass through — reclassifying would lose the author's signal.
  if (/^\s*\[ok\]/i.test(raw)) return raw;

  // Strip leading emoji/symbol prefixes so that "✅ Resolved",
  // "🟡 Partial", "⬜ Open", "🟢 Partial (adopted …)" don't dominate
  // the match. Use Unicode property escapes so oxlint does not flag the
  // emoji class for combining characters. Brackets like `[OK]` are
  // NOT stripped here — they're freeform signal handled separately.
  const stripped = lower
    .replace(/^[\s\p{Extended_Pictographic}\p{Symbol}]+/u, "")
    .trim();

  // Specific negative — check before the done-regex so the substring
  // "implemented" inside "not-yet-implemented" doesn't dominate.
  if (/\bnot[- ]yet[- ]implemented\b/.test(stripped)) return "open";

  // Specific partials — check before done-regex so "Partially Implemented"
  // doesn't trip on the "implemented" keyword.
  if (
    /\b(partial|partially[- ]?(built|implemented|done)|foundation)\b/.test(stripped)
  ) return "in_progress";
  if (/\bwip\b|\bin[- ]progress\b/.test(stripped)) return "in_progress";

  // Resolved-class: any "resolved", "fixed", "implemented", "finished",
  // "shipped" — with or without trailing commit/date annotation.
  if (
    /\b(done|complete[d]?|closed|resolved|fixed|implemented|finished|shipped)\b/.test(stripped)
  ) return "done";
  // fixed-in-worktree is the loop-lore convention for a fix landed in a
  // branch that hasn't merged yet — treat as done for reconciliation.
  if (stripped.includes("fixed-in-worktree")) return "done";
  // Reconciliation markers: `duplicate-of-…` stubs are closed work —
  // mirrors omp-plugins find-work's STATUS_DONE_RE duplicate class so both
  // parsers close dual-status stubs identically.
  if (/\bduplicate([- ]of)?\b/.test(stripped)) return "done";

  // Open-class: explicit "open", "deferred", "todo", "research needed",
  // "follow-up".
  if (
    lower === "open" || stripped.startsWith("open")
    || /\b(deferred|todo|research[- ]needed|follow[- ]up)\b/.test(stripped)
  ) return "open";

  if (lower.includes("draft")) return "draft";
  if (lower.includes("cancelled") || lower.includes("canceled")) return "cancelled";

  // Pass-through: freeform notes ("not-a-bug", "[OK] documented in …",
  // "stale", "🔄 split into two tickets below", "🟡 permanently ongoing").
  // These are intentional state comments — reclassifying would lose signal.
  return raw;
}
