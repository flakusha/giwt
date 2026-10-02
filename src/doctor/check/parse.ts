// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Parsers for doctor check tool output (pure — unit tested against live
 * tool output shapes): eslint, biome, oxlint, tsc, and test runners.
 */

import { relToRoot } from "./util.ts";

export interface LintFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
  error: boolean;
}

/**
 * Parse `eslint --format json` ([{filePath, messages[]}]). Empty output
 * (clean lint) yields []; non-empty unparseable output throws.
 */
export function parseEslintJson(stdout: string, root: string): LintFinding[] {
  if (!stdout.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("eslint: unparseable JSON output");
  }
  if (!Array.isArray(data)) throw new Error("eslint: unexpected JSON shape");
  const out: LintFinding[] = [];
  for (const file of data) {
    const f = file as { filePath?: unknown; messages?: unknown; };
    if (typeof f.filePath !== "string" || !Array.isArray(f.messages)) continue;
    for (const raw of f.messages) {
      const m = raw as { ruleId?: unknown; severity?: unknown; message?: unknown; line?: unknown; };
      out.push({
        file: relToRoot(root, f.filePath),
        line: typeof m.line === "number" ? m.line : 0,
        rule: typeof m.ruleId === "string" && m.ruleId ? m.ruleId : "eslint",
        message: typeof m.message === "string" ? m.message : "",
        error: m.severity === 2,
      });
    }
  }
  return out;
}

/** Biome rule groups treated as bugs (likely broken, not just style). */
const BIOME_BUG_PREFIXES = ["lint/correctness/", "lint/suspicious/", "parse/"];

/** `path:line:col rule ━━━` header lines in `biome check` output. */
const BIOME_HEADER_RE = /^(\S+):(\d+):(\d+)\s+([\w@/.~$-]+)/;
/** Diagnostic message lines (`!`, `×`, `?`, `i` markers). */
const BIOME_MESSAGE_RE = /^\s*[!×?i]\s+(.+?)\s*$/;

/**
 * Parse `biome check` human output. Correctness/suspicious/parse rules map
 * to errors (they flag likely-broken code); style and friends map to
 * warnings.
 */
export function parseBiomeOutput(stdout: string, root: string): LintFinding[] {
  const lines = stdout.split(/\r?\n/);
  const out: LintFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = BIOME_HEADER_RE.exec(lines[i] ?? "");
    if (!h?.[1] || !h[2] || !h[4]) continue;
    let message = h[4];
    for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
      const msg = BIOME_MESSAGE_RE.exec(lines[j] ?? "");
      if (msg?.[1]) {
        message = msg[1];
        break;
      }
      if (BIOME_HEADER_RE.test(lines[j] ?? "")) break;
    }
    const rule = h[4];
    out.push({
      file: relToRoot(root, h[1]),
      line: Number(h[2]),
      rule,
      message,
      error: BIOME_BUG_PREFIXES.some((p) => rule.startsWith(p)),
    });
  }
  return out;
}

/**
 * Parse `oxlint --format json` (`{diagnostics: [...]}`). Empty output
 * yields []; non-empty unparseable output throws.
 */
export function parseOxlintJson(stdout: string, root: string): LintFinding[] {
  if (!stdout.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("oxlint: unparseable JSON output");
  }
  const diags = (data as { diagnostics?: unknown; })?.diagnostics;
  if (!Array.isArray(diags)) throw new Error("oxlint: unexpected JSON shape");
  const out: LintFinding[] = [];
  for (const raw of diags) {
    const d = raw as {
      message?: unknown;
      code?: unknown;
      severity?: unknown;
      filename?: unknown;
      labels?: unknown;
    };
    const spans = Array.isArray(d.labels) ? d.labels : [];
    const first = spans[0] as { span?: { line?: unknown; }; } | undefined;
    const line = first?.span && typeof first.span.line === "number" ? first.span.line : 0;
    out.push({
      file: typeof d.filename === "string" ? relToRoot(root, d.filename) : "",
      line,
      rule: typeof d.code === "string" && d.code ? d.code : "oxlint",
      message: typeof d.message === "string" ? d.message : "",
      error: d.severity === "error",
    });
  }
  return out;
}

export interface TscError {
  file: string;
  line: number;
  code: string;
  message: string;
}

/** `path(line,col): error TS####: message` lines in `tsc --noEmit` output. */
const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.+?)\s*$/;

/** Parse `tsc --noEmit` output; summary lines are skipped. */
export function parseTscOutput(stdout: string, root: string): TscError[] {
  const out: TscError[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = TSC_LINE_RE.exec(line);
    if (!m?.[1] || !m[2] || !m[4] || !m[5]) continue;
    out.push({ file: relToRoot(root, m[1]), line: Number(m[2]), code: m[4], message: m[5] });
  }
  return out;
}

export interface TestFailure {
  name: string;
}

/**
 * Parse test-runner failure lines: bun `(fail)`, jest/vitest `FAIL`,
 * pytest `FAILED`, go `--- FAIL:`. Falls back to a single summary ticket
 * when a nonzero failure count is stated but no lines parse.
 */
export function parseTestOutput(stdout: string): TestFailure[] {
  const out: TestFailure[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    let m = /^\(fail\)\s+(.+?)(?:\s+\[\d[^\]]*\])?\s*$/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1].trim() });
      continue;
    }
    m = /^FAIL\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1].trim() });
      continue;
    }
    m = /^FAILED\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1].trim() });
      continue;
    }
    m = /^--- FAIL:\s+(\S+)/.exec(line);
    if (m?.[1]) {
      out.push({ name: m[1] });
    }
  }
  if (out.length === 0) {
    const sum = /(\d+)\s+(?:tests?\s+)?fail(?:ed|ing|ures)?\b/i.exec(stdout);
    if (sum?.[1] && Number(sum[1]) > 0) {
      out.push({ name: `${sum[1]} failing (see test output)` });
    }
  }
  return out;
}
