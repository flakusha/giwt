// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orphaned trailing-block scan — weave damage check 2 (FEAT-weave-damage-
 * scan), covering both observed shapes:
 *
 *   - statements stranded after the last top-level declaration (the 17
 *     appended parameter copies in ui.ts), and
 *   - an appended binding nothing references (the orphaned `const globals`
 *     in isolate-only.ts).
 *
 * No AST: a line starting at column 0 that begins a top-level declaration,
 * a bare call (`main();`, test blocks), or closes one (`}`, `});`) is a
 * structural anchor; everything after the LAST anchor that is real code
 * (not blank, not comment-only) is the trailing block. A file with no
 * anchors at all (config blobs, scripts without imports) cannot be
 * reasoned about structurally and is left alone. A single trailing bare
 * call whose callee is declared in the file is the legitimate entry-point
 * invocation pattern and is exempt.
 */

import type { AuditFinding } from "../types";

const TOP_LEVEL_ANCHOR_RE =
  /^(?:export\s+|declare\s+|abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\b|^import\b|^@\w|^[A-Za-z_$][\w$]*\s*\(/;
const TOP_LEVEL_CLOSER_RE = /^[)}\];]/;
const BINDING_DECL_RE = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const BARE_CALL_RE = /^(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/;
const COMMENT_ONLY_RE = /^\s*(?:\/\/|\/\*|\*|#|$)/;

export function scanTrailing({ text, path }: { text: string; path: string; }): AuditFinding[] {
  const lines = text.split("\n");
  let lastAnchor = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (TOP_LEVEL_ANCHOR_RE.test(line) || TOP_LEVEL_CLOSER_RE.test(line)) lastAnchor = i;
  }
  if (lastAnchor === -1) return [];

  const findings: AuditFinding[] = [...bindingFindings({ lines, lastAnchor, path })];

  const codeLines: Array<[number, string]> = [];
  for (let i = lastAnchor + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!COMMENT_ONLY_RE.test(line)) codeLines.push([i + 1, line.trim()]);
  }
  if (codeLines.length === 0) return findings;
  if (codeLines.length === 1 && exemptEntryPointCall(text, codeLines[0]?.[1] ?? "")) {
    return findings;
  }
  const start = codeLines[0]?.[0] ?? 0;
  const end = codeLines[codeLines.length - 1]?.[0] ?? start;
  findings.push({
    detector: "weave",
    reason: "orphaned-trailing-block",
    severity: codeLines.length > 1 ? "warning" : "info",
    rank: codeLines.length > 1 ? 55 : 35,
    message:
      `${codeLines.length} statement line(s) after the last top-level declaration — a merge resolution probably concatenated a region`,
    paths: [path],
    evidence: [
      { kind: "line", path, start, end, content: (codeLines[0]?.[1] ?? "").slice(0, 120) },
      { kind: "count", detail: `${codeLines.length} trailing code lines (lines ${start}–${end})` },
    ],
  });
  return findings;
}

/** Unexported `const/let/var NAME` bindings with zero other occurrences in
 * the file: checked among the trailing region AND at the last anchor itself
 * (an appended orphan binding usually becomes the last anchor, so the
 * region after it is empty and only this check can catch it). */
function bindingFindings({
  lines,
  lastAnchor,
  path,
}: {
  lines: readonly string[];
  lastAnchor: number;
  path: string;
}): AuditFinding[] {
  const text = lines.join("\n");
  const findings: AuditFinding[] = [];
  const candidates = new Set<number>();
  candidates.add(lastAnchor);
  for (let i = lastAnchor + 1; i < lines.length; i++) candidates.add(i);
  for (const i of candidates) {
    const line = lines[i] ?? "";
    if (line.startsWith("export")) continue;
    const match = BINDING_DECL_RE.exec(line);
    if (match === null) continue;
    const name = match[1] ?? "";
    const occurrences = text.split(new RegExp(`\\b${name}\\b`)).length - 1;
    if (occurrences > 1) continue;
    findings.push({
      detector: "weave",
      reason: "orphaned-binding",
      severity: "warning",
      rank: 60,
      message: `orphaned binding \`${name}\` at the end of the file has no referents`,
      paths: [path],
      evidence: [
        { kind: "line", path, start: i + 1, end: i + 1, content: line.trim().slice(0, 120) },
        { kind: "token", detail: `binding ${name}` },
      ],
    });
  }
  return findings;
}

/** `main();` style entry invocation: exempt only when the callee is declared
 * somewhere in the file (a real entry point, not stranded code). */
function exemptEntryPointCall(text: string, trimmed: string): boolean {
  const match = BARE_CALL_RE.exec(trimmed);
  if (match === null) return false;
  const callee = match[1] ?? "";
  if (["if", "for", "while", "switch", "describe", "it", "test"].includes(callee)) {
    return false;
  }
  return new RegExp(
    `(?:function\\s+${callee}\\b|(?:const|let|var)\\s+${callee}\\b)`,
  ).test(text);
}
