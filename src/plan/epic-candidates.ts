// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Split a multi-epic `**Epic:**` value into candidates, in author order
 * (ported from loop-lore's epic-owner-pick.ts). A `/` inside parentheses
 * (`A (X/Y)`) or a `.plan/epics/…` path is not a separator.
 */
export function splitEpicCandidates(raw: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  const push = () => {
    // Order matters: strip the `(note)` annotation BEFORE the `.md` suffix
    // (a `x.md` (logging) token ends in a paren, not in `.md`), and strip
    // backticks both before and after (a trailing backtick hides `.md`).
    const token = current
      .trim()
      .replace(/^[`*>\s]*/, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .replace(/[`*\s]*$/, "")
      .replace(/^\.plan\/epics\//, "")
      .replace(/\.md$/i, "")
      .replace(/[`*\s]*$/, "")
      .trim();
    if (token) chunks.push(token);
    current = "";
  };
  for (const char of raw) {
    if (char === "(") depth++;
    if (char === ")" && depth > 0) depth--;
    // `+` joins two candidates exactly like `,` does (`a.md (x) + b.md (y)`)
    // — but ONLY when both sides carry a parenthetical role note; otherwise
    // it is title prose (`Avatar Alpha Channel + VN Layering`) and splitting
    // would destroy an exact table match.
    const plusJoins = char === "+" && depth === 0 && /\([^)]*\)\s*$/.test(current);
    const isSep = char === "," || char === ";" || (char === "/" && depth === 0) || plusJoins;
    if (isSep && !current.includes(".plan/epics/")) {
      push();
    } else {
      current += char;
    }
  }
  push();
  return chunks;
}
