// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Brace-balance scan — weave damage check 4 (FEAT-weave-damage-scan).
 *
 * Compares the file's brace shape against the pre-merge version of the same
 * file. Net imbalance (warning) catches dropped/added halves of a region.
 * Equal nets with a large gross-count delta catch the quieter signature:
 * a duplicated region adds BALANCED braces (the triplicated ui.ts block),
 * so opens and closes grow together by the same step.
 *
 * Counting is string/comment-aware (quotes, template literals with nested
 * ${…}, line and block comments are stripped first) but not regex-literal
 * aware — a regex containing an unbalanced brace skews the count. That is
 * why the delta check is ranked info, and the net check only fires on a
 * genuinely unbalanced file.
 */

import type { AuditFinding } from "../types";

export const BRACE_DELTA_DEFAULT = 4;

export interface BraceStats {
  opens: number;
  closes: number;
  /** opens − closes at EOF. */
  net: number;
  /** Lowest running depth ever reached — negative means a closer with no opener. */
  minDepth: number;
}

type CodeState = "code" | "line" | "block" | "single" | "double" | "template";

interface InterpolationDepth {
  interpolation: number;
  braces: number;
}

/** One code-state transition: returns the next state, the text to emit
 * (null = the char opens a non-code region and is dropped), and how many
 * characters the transition consumed (2 for the // and /* openers). */
interface CodeTransitionParams {
  c: string;
  d: string;
  depth: InterpolationDepth;
}

function codeTransition({ c, d, depth }: CodeTransitionParams): [CodeState, string | null, number] {
  if (c === "/" && d === "/") return ["line", null, 2];
  if (c === "/" && d === "*") return ["block", null, 2];
  if (c === "'") return ["single", null, 1];
  if (c === "\"") return ["double", null, 1];
  if (c === "`") return ["template", null, 1];
  if (c === "{") depth.braces++;
  if (c === "}" && depth.interpolation > 0 && depth.braces === 0) {
    depth.interpolation--;
    return ["template", c, 1];
  }
  if (c === "}") depth.braces--;
  return ["code", c, 1];
}

/** Strip string/template/comment content so braces inside prose do not
 * count. `}` inside a template interpolation only ends the interpolation
 * when the interpolation's own brace depth is back to zero — an object
 * literal inside `${…}` must not swallow the interpolation's closer. */
export function codeOnly(text: string): string {
  let out = "";
  const depth: InterpolationDepth = { interpolation: 0, braces: 0 };
  let state: CodeState = "code";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    const d = text[i + 1] ?? "";
    if (state === "code") {
      const [next, emit, consumed] = codeTransition({ c, d, depth });
      state = next;
      if (emit !== null) out += emit;
      i += consumed - 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") {
        state = "code";
        i++;
      }
      continue;
    }
    if (state === "single" || state === "double") {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === (state === "single" ? "'" : "\"")) state = "code";
      continue;
    }
    // template literal: keep ${ } interpolations (they may hold braces)
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") {
      state = "code";
      continue;
    }
    if (c === "$" && d === "{") {
      depth.interpolation++;
      state = "code";
      out += "${";
      i++;
    }
  }
  return out;
}

export function braceStats(text: string): BraceStats {
  const code = codeOnly(text);
  let depth = 0;
  let minDepth = 0;
  let opens = 0;
  let closes = 0;
  for (const c of code) {
    if (c === "{") {
      opens++;
      depth++;
    } else if (c === "}") {
      closes++;
      depth--;
    }
    if (depth < minDepth) minDepth = depth;
  }
  return { opens, closes, net: opens - closes, minDepth };
}

export interface BraceScanOptions {
  text: string;
  path: string;
  /** Pre-merge text of the same file; without it only imbalance is checked. */
  baseline?: string;
  /** Gross-count delta vs baseline that counts as an anomaly (default 4). */
  minDelta?: number;
}

export function scanBraces({
  text,
  path,
  baseline,
  minDelta = BRACE_DELTA_DEFAULT,
}: BraceScanOptions): AuditFinding[] {
  const current = braceStats(text);
  const findings: AuditFinding[] = [];
  if (current.net !== 0 || current.minDepth < 0) {
    findings.push({
      detector: "weave",
      reason: "brace-anomaly",
      severity: "warning",
      rank: 65,
      message: `unbalanced braces (net ${
        current.net >= 0 ? "+" : ""
      }${current.net}, min depth ${current.minDepth})`,
      paths: [path],
      evidence: [{ kind: "count", detail: `${current.opens} opens / ${current.closes} closes` }],
    });
  }
  if (baseline === undefined) return findings;
  const before = braceStats(baseline);
  if (before.net !== current.net) {
    findings.push({
      detector: "weave",
      reason: "brace-anomaly",
      severity: "warning",
      rank: 60,
      message: `brace balance changed vs pre-merge version (net ${before.net} → ${current.net})`,
      paths: [path],
      evidence: [
        { kind: "count", detail: `baseline ${before.opens}/${before.closes}` },
        { kind: "count", detail: `current ${current.opens}/${current.closes}` },
      ],
    });
  } else if (
    Math.abs(current.opens - before.opens) >= minDelta
    && Math.abs(current.closes - before.closes) >= minDelta
  ) {
    findings.push({
      detector: "weave",
      reason: "brace-anomaly",
      severity: "info",
      rank: 45,
      message:
        `brace volume anomaly vs pre-merge version — a balanced region was probably duplicated or dropped`,
      paths: [path],
      evidence: [
        { kind: "count", detail: `opens ${before.opens} → ${current.opens}` },
        { kind: "count", detail: `closes ${before.closes} → ${current.closes}` },
      ],
    });
  }
  return findings;
}
