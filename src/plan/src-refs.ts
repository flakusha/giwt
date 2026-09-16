// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure helpers for plan↔code cross-reference extraction.
 *
 * Two directions:
 *   1. `extractComments` + `extractDocRefs` — extract a TypeScript file's
 *      comments and pull out `docs/…` / `.plan/…` path references
 *      (used by check-links to catch stale source-comment citations).
 *   2. `extractSrcRefs` — pull `src/…` path tokens out of plan / spec
 *      markdown (used by code-map to build the reverse index).
 *
 * Kept free of process.exit / argv / fs so both are unit-testable.
 *
 * NOTE: Comment extraction uses regex, not the TypeScript AST (TS 7+
 * restructured its compiler API exports). This is sufficient for the
 * doc/plan path-reference use case; string literals are stripped first
 * to avoid false matches on URLs containing `//` or `/*`.
 */

// ── Direction 1: TS comments → doc refs ────────────────────────

/**
 * Strip string literals from TypeScript source to prevent false matches
 * on `//` or `/*` inside strings. Handles double-quoted, single-quoted,
 * and template literals. Escaped quotes within strings are respected.
 */
function stripStrings(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    // Double-quoted string
    if (ch === "\"") {
      out += "\"\"";
      i++;
      while (i < source.length && source[i] !== "\"") {
        if (source[i] === "\\" && i + 1 < source.length) i += 2;
        else i++;
      }
      i++; // skip closing quote
      continue;
    }
    // Single-quoted string
    if (ch === "'") {
      out += "''";
      i++;
      while (i < source.length && source[i] !== "'") {
        if (source[i] === "\\" && i + 1 < source.length) i += 2;
        else i++;
      }
      i++;
      continue;
    }
    // Template literal (simplified — doesn't handle nested ${} fully)
    if (ch === "`") {
      out += "``";
      i++;
      while (i < source.length && source[i] !== "`") {
        if (source[i] === "\\" && i + 1 < source.length) i += 2;
        else i++;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Extract every comment (block + line) from a TS source string.
 * Uses regex after stripping string literals to avoid false matches.
 * Deduped by position (each comment reported once).
 */
export function extractComments(source: string): string[] {
  const cleaned = stripStrings(source);
  const comments: string[] = [];
  const seen = new Set<number>();
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (!seen.has(m.index)) {
      seen.add(m.index);
      comments.push(m[0]);
    }
  }
  return comments;
}

/** A doc/plan path reference found inside a source comment. */
export interface DocRef {
  /** The raw path token, e.g. `docs/spec/lore.md`. */
  path: string;
}

/**
 * Path-token regex matching intra-repo doc/plan citations. Captures the path
 * up to (and including) `.md`; trailing `§section`, `#fragment`, punctuation
 * and quotes are left out of the match.
 */
const DOC_REF_RE = /(?:docs|\.plan)\/[A-Za-z0-9/._-]+\.md/g;

/** Extract doc/plan path references (deduped) from a comment body. */
export function extractDocRefs(commentText: string): DocRef[] {
  const refs: DocRef[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(DOC_REF_RE.source, "g");
  while ((m = re.exec(commentText)) !== null) {
    const path = m[0];
    if (seen.has(path)) continue;
    seen.add(path);
    refs.push({ path });
  }
  return refs;
}

// ── Direction 2: markdown → src refs ────────────────────────────

/**
 * Strip fenced code blocks (```…```) from markdown. Inline code spans are
 * KEPT — in plan/spec prose, backticked `src/…` tokens are the primary
 * reference format (not example code to ignore).
 */
export function stripMarkdownCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/** A `src/…` path token found in plan/spec prose. */
export interface SrcRef {
  /** Normalized path token, e.g. `src/rpg/quests/service`. */
  path: string;
}

const SRC_REF_RE = /src\/[A-Za-z0-9/._-]+/g;

/**
 * Extract `src/…` path tokens from markdown prose (code stripped). Normalizes
 * each token by trimming trailing punctuation and `:line` suffixes, and skips
 * glob/pattern tokens (containing `*`).
 */
export function extractSrcRefs(markdown: string): SrcRef[] {
  const body = stripMarkdownCode(markdown);
  const refs: SrcRef[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = SRC_REF_RE.exec(body)) !== null) {
    let path = m[0];
    // Trim trailing punctuation / inline-code remnants / line refs.
    path = path.replace(/[:;,).\]'"*]+$/, "");
    // Skip glob patterns and bare directory tokens.
    if (path.includes("*")) continue;
    if (path === "src" || path === "src/" || path.endsWith("/")) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    refs.push({ path });
  }
  return refs;
}
