// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `todo` check — TODO/FIXME comments in code (pure FS scan).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  capFindings,
  CHECK_MAX_FINDINGS,
  type CheckFinding,
  type CheckResult,
  type CheckSeverity,
} from "./types.ts";

// Action-item shape only: TODO/FIXME optionally scoped `TODO(scope)`, then a
// colon. Prose mentions ("todo, scratchpad", "TODO/FIXME comments") don't
// match, so documentation lines never surface as findings.
const TODO_MARKER_RE = /\b(TODO|FIXME)(\([^)]*\))?:/i;

const TODO_EXTS: Record<string, true> = {
  ".ts": true,
  ".tsx": true,
  ".js": true,
  ".jsx": true,
  ".mjs": true,
  ".cjs": true,
  ".mts": true,
  ".cts": true,
  ".py": true,
  ".go": true,
  ".rs": true,
  ".java": true,
  ".kt": true,
  ".rb": true,
  ".php": true,
  ".swift": true,
  ".c": true,
  ".h": true,
  ".cpp": true,
  ".hpp": true,
  ".cs": true,
  ".sh": true,
  ".bash": true,
  ".css": true,
  ".scss": true,
  ".html": true,
  ".vue": true,
  ".svelte": true,
  ".sql": true,
  ".lua": true,
};

const TODO_SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
  target: true,
  dist: true,
  build: true,
  ".next": true,
  coverage: true,
  vendor: true,
  ".venv": true,
  venv: true,
  __pycache__: true,
  ".turbo": true,
  ".tmp": true,
  ".plan": true,
  ".omp": true,
  ".serena": true,
  ".vscode": true,
  ".idea": true,
};

/** Test fixture dirs never hold actionable TODOs (scaffold noise). */
const TODO_TEST_DIRS: Record<string, true> = {
  __tests__: true,
  tests: true,
  test: true,
  spec: true,
  fixtures: true,
  testdata: true,
  __snapshots__: true,
};

/** Test file stems never hold actionable TODOs (`a.test.ts`, `test_x.py`). */
function isTestFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  const stem = (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();
  const lower = name.toLowerCase();
  return (
    lower.includes(".test.")
    || lower.includes(".spec.")
    || stem.startsWith("test_")
    || stem.startsWith("test-")
    || stem.endsWith("_test")
    || stem.endsWith("-test")
  );
}

/** The marker must sit inside a comment (`//`, `#`, `/*`, `*`, …) —
 *  bare identifiers in string literals and ternaries are not work items.
 *  Descriptions shorter than 2 chars are not actionable — skip them. */
const TODO_COMMENT_BEFORE_RE = /(^|\s)(?:\/\/|#|\/\*|\*|<!--|--|%|;)/;
const TODO_MIN_TEXT = 2;

const TODO_MAX_FILES = 600;
const TODO_MAX_FILE_BYTES = 200_000;

export interface TodoMatch {
  file: string;
  line: number;
  marker: "TODO" | "FIXME";
  text: string;
}

function todoExt(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && (TODO_EXTS[name.slice(dot).toLowerCase()] ?? false);
}

/** Comment text after the marker, with separators stripped. */
function todoText(line: string, marker: string): string {
  const at = line.search(new RegExp(`\\b${marker}\\b`, "i"));
  const after = at >= 0 ? line.slice(at + marker.length) : line;
  return after
    .replace(/^[\s:([-]*/, "")
    .replace(/(\*\/|-->)\s*$/, "")
    .trim();
}

/** Collect candidate source files, honoring skip dirs and caps. */
function collectTodoFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < TODO_MAX_FILES) {
    const dir = stack.pop() as string;
    let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean; }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }));
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (entry.name.startsWith(".") || TODO_SKIP_DIRS[entry.name]) continue;
        if (TODO_TEST_DIRS[entry.name]) continue;
        stack.push(join(dir, entry.name));
      } else if (entry.isFile && !isTestFile(entry.name) && todoExt(entry.name)) {
        out.push(join(dir, entry.name));
        if (out.length >= TODO_MAX_FILES) break;
      }
    }
  }
  return out;
}

/** Scan one file for TODO/FIXME lines; skips oversized/unreadable files. */
function scanTodoFile(abs: string): TodoMatch[] {
  let text: string;
  try {
    if (statSync(abs).size > TODO_MAX_FILE_BYTES) return [];
    text = readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  const matches: TodoMatch[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line.length > 500) continue; // minified/blob line
    const m = TODO_MARKER_RE.exec(line);
    if (!m?.[1]) continue;
    if (!TODO_COMMENT_BEFORE_RE.test(line.slice(0, m.index))) continue;
    const marker = m[1].toUpperCase() === "FIXME" ? "FIXME" : "TODO";
    const desc = todoText(line, marker);
    if (desc.length < TODO_MIN_TEXT) continue;
    matches.push({ file: abs, line: i + 1, marker, text: desc });
  }
  return matches;
}

export function runTodo(root: string): CheckResult {
  const base = {
    id: "todo" as const,
    tool: "comment-scan",
    ok: true,
    findings: [] as CheckFinding[],
  };
  const matches: TodoMatch[] = [];
  for (const file of collectTodoFiles(root)) {
    matches.push(...scanTodoFile(file));
    if (matches.length >= CHECK_MAX_FINDINGS * 2) break;
  }
  matches.sort((a, b) => {
    if (a.marker !== b.marker) return a.marker === "FIXME" ? -1 : 1;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
  return {
    ...base,
    // The collect walk itself stops at CHECK_MAX_FINDINGS * 2 matches, so
    // findingsTotal is the collected total: the notice is honest about what
    // was found up to that bound (matching the pre-existing walk cap).
    ...capFindings(matches.map((m) => ({
      file: relative(root, m.file),
      line: m.line,
      rule: m.marker,
      message: m.text || "(no description)",
      severity: (m.marker === "FIXME" ? "error" : "warning") as CheckSeverity,
      kind: (m.marker === "FIXME" ? "bug" : "task") as "bug" | "task",
    }))),
  };
}
