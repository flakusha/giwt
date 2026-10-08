// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Identifier-insensitive text comparison — the shared seam behind both the
 * rename-tolerant commit fingerprint (BUG-patch-id) and the resurrected-file
 * content-twin check (FEAT-detect-resurrected-files).
 *
 * Two texts are twins when they are equal after replacing the embedded
 * identifiers of BOTH paths (the migration name in a docblock, a module
 * path in an import, a file's own basename — whichever side owns the
 * token) with a placeholder and normalizing version literals. Both texts
 * are normalized against the union of both token sets, because drifted
 * identifiers name the *other* side's path as often as their own (an R097
 * rename tweaks the docblock to the new name). The evidence pass then
 * names the exact tokens that differed. Pure string work — no git, no fs.
 */

import { posix } from "node:path";

/** Tokens shorter than this are too likely to be substrings of unrelated
 * words (`api` inside `rapid`) to blanket-replace. */
const MIN_TOKEN_LENGTH = 3;

const ID_PLACEHOLDER = "\u0000ID\u0000";
const VERSION_PLACEHOLDER = "\u0000VER\u0000";

/** Version-ish literals: `1.2.3`, `v0.4.1`, `2.0.0-rc.1` (never bare ints). */
export const VERSION_LITERAL_RE = /\bv?\d+(?:\.\d+){1,3}(?:-[\w.]+)?\b/g;

/** Self-referential identifier tokens a file plausibly embeds about itself. */
export function identifierTokensFor(path: string): string[] {
  const base = posix.basename(path);
  const stem = base.replace(/\.[^.]+$/, "");
  const parent = posix.dirname(path);
  const candidates = [path, `${parent}/${stem}`, base, stem];
  if (parent !== "." && parent.length >= MIN_TOKEN_LENGTH) candidates.push(parent);
  return [...new Set(candidates)]
    .filter((t) => t.length >= MIN_TOKEN_LENGTH)
    .sort((a, b) => b.length - a.length);
}

/** Replace every occurrence of each token (longest first) with a placeholder. */
export function normalizeIdentifiers(text: string, tokens: readonly string[]): string {
  let out = text;
  for (const token of tokens) out = out.replaceAll(token, ID_PLACEHOLDER);
  return out;
}

/** Rewrite all version literals to one placeholder so version-only drift vanishes. */
export function normalizeVersionLiterals(text: string): string {
  return text.replace(VERSION_LITERAL_RE, VERSION_PLACEHOLDER);
}

/** Longest-first union of both sides' tokens: whichever side owns a drifted
 * identifier, it erases from both texts. */
function unionTokens(tokensA: readonly string[], tokensB: readonly string[]): string[] {
  return [...new Set([...tokensA, ...tokensB])].sort((a, b) => b.length - a.length);
}

export interface TwinVerdict {
  twin: boolean;
  /** Byte-identical inputs — no tokens needed to explain the match. */
  identical: boolean;
  /** `a → b` evidence strings naming the embedded tokens that differed. */
  differingTokens: string[];
}

const NOT_TWINS: TwinVerdict = { twin: false, identical: false, differingTokens: [] };

/**
 * Compare two texts for twin-ness. Equality is decided on the normalized
 * forms; token evidence is then extracted from the raw lines that differ.
 * A token never contains a newline and version literals never span lines,
 * so equal normalized forms imply equal line counts.
 */
export function compareTwins({
  textA,
  pathA,
  textB,
  pathB,
}: {
  textA: string;
  pathA: string;
  textB: string;
  pathB: string;
}): TwinVerdict {
  if (textA === textB) return { twin: true, identical: true, differingTokens: [] };
  const tokensA = identifierTokensFor(pathA);
  const tokensB = identifierTokensFor(pathB);
  const tokens = unionTokens(tokensA, tokensB);
  const normalizedA = normalizeVersionLiterals(normalizeIdentifiers(textA, tokens));
  const normalizedB = normalizeVersionLiterals(normalizeIdentifiers(textB, tokens));
  if (normalizedA !== normalizedB) return NOT_TWINS;
  return {
    twin: true,
    identical: false,
    differingTokens: tokenEvidence(
      { text: textA, tokens: tokensA },
      { text: textB, tokens: tokensB },
    ),
  };
}

/** One side of a twin comparison: text plus its path-derived tokens. */
interface TwinSide {
  text: string;
  tokens: readonly string[];
}

/**
 * Walk the raw line pairs; a differing line counts as explained when
 * swapping one token of A for one token of B (or one version literal for
 * another) makes the pair equal. Normalization never adds or removes
 * newlines, so equal normalized forms imply equal line counts.
 */
function tokenEvidence(sideA: TwinSide, sideB: TwinSide): string[] {
  const linesA = sideA.text.split("\n");
  const linesB = sideB.text.split("\n");
  const evidence: string[] = [];
  for (let i = 0; i < linesA.length; i++) {
    const lineA = linesA[i] ?? "";
    const lineB = linesB[i] ?? "";
    if (lineA === lineB) continue;
    const pair = tokenPairForLine({ lineA, tokensA: sideA.tokens, lineB, tokensB: sideB.tokens })
      ?? versionPairForLine(lineA, lineB);
    if (pair !== undefined && !evidence.includes(pair)) evidence.push(pair);
  }
  return evidence;
}

function tokenPairForLine({
  lineA,
  tokensA,
  lineB,
  tokensB,
}: {
  lineA: string;
  tokensA: readonly string[];
  lineB: string;
  tokensB: readonly string[];
}): string | undefined {
  for (const ta of tokensA) {
    if (!lineA.includes(ta)) continue;
    const replacedA = lineA.replaceAll(ta, ID_PLACEHOLDER);
    for (const tb of tokensB) {
      if (lineB.includes(tb) && replacedA === lineB.replaceAll(tb, ID_PLACEHOLDER)) {
        return `${ta} → ${tb}`;
      }
    }
  }
  return undefined;
}

function versionPairForLine(lineA: string, lineB: string): string | undefined {
  const versionsA = lineA.match(VERSION_LITERAL_RE);
  const versionsB = lineB.match(VERSION_LITERAL_RE);
  if (
    versionsA === null || versionsB === null
    || versionsA.length !== versionsB.length
    || lineA.replace(VERSION_LITERAL_RE, VERSION_PLACEHOLDER)
      !== lineB.replace(VERSION_LITERAL_RE, VERSION_PLACEHOLDER)
  ) {
    return undefined;
  }
  return `${versionsA.join(", ")} → ${versionsB.join(", ")}`;
}
