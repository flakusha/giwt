// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Doctor health checks — run repo-health tools and report findings.
 *
 * Inventory (mirrors omp `/find-work` tool sources so the two stay
 * mutually intelligible):
 *   lint       configured linter: eslint > biome > oxlint
 *   typecheck  tsc --noEmit (tsconfig.json present)
 *   tests      package.json test script (command from settings.commands.test)
 *   knip       unused exports/dependencies (knip configured)
 *   jscpd      copy-paste clones (jscpd configured)
 *   todo       TODO/FIXME comments in code (pure FS scan)
 *   scratchpad .tmp scratchpad bloat — total bytes, orphan *.tmp count,
 *              oldest artifact age, largest dirs (pure FS, scanScratch)
 *
 * Machine contract (omp `/find-work` consumes this):
 *   giwt doctor check --json  →  DoctorCheckReport JSON on stdout. NOTE:
 *   giwt's dispatcher prints a run-record announcement line before command
 *   output, so consumers must parse from the first `{`, not from offset 0.
 *   Finding severity/kind map 1:1 to work tickets: error/bug = must-fix,
 *   warning/task = hygiene. Exit code is 1 when any error-severity finding
 *   exists or a check fails to run, else 0 — warnings alone never fail.
 *
 * Runners shell out via Bun.spawnSync (giwt convention: no timeouts, the
 * operator owns cancellation). Every runner is best-effort: a nonzero exit
 * with parseable findings still yields tickets; a nonzero exit with none
 * becomes a check error carrying the output tail.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  DEFAULT_SCRATCH_CONFIG,
  DEFAULT_SCRATCHPAD_THRESHOLDS,
  largestDirs,
  scanScratch,
} from "../utils/scratch.ts";
import type { ScratchConfig, ScratchpadThresholds } from "../utils/scratch.ts";
import { detectProject } from "./detect.ts";

export type CheckId = "lint" | "typecheck" | "tests" | "knip" | "jscpd" | "todo" | "scratchpad";

export const CHECK_IDS: readonly CheckId[] = [
  "lint",
  "typecheck",
  "tests",
  "knip",
  "jscpd",
  "todo",
  "scratchpad",
];

export type CheckSeverity = "error" | "warning";

export interface CheckFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
  severity: CheckSeverity;
  kind: "bug" | "task";
}

export interface CheckResult {
  id: CheckId;
  /** Concrete tool invoked (e.g. "oxlint", "tsc --noEmit", "bun run test"). */
  tool: string;
  ok: boolean;
  /** Present when the check was skipped (not applicable, with reason). */
  skipped?: string;
  /** Present when the check failed to run (stderr tail, capped). */
  error?: string;
  findings: CheckFinding[];
  /** Human-readable summary lines (e.g. scratchpad sizes/ages); the doctor
   *  renderer prints them after the findings. Additive to the v1 report
   *  contract — consumers that ignore it stay compatible. */
  notes?: string[];
}

export interface DoctorCheckReport {
  version: 1;
  root: string;
  checks: CheckResult[];
}

/** Max findings kept per check (bounds JSON + human output). */
export const CHECK_MAX_FINDINGS = 20;

/** jscpd languages passed via -f (verified to exist; unknown names fail the run). */
const JSCPD_FORMATS = "typescript,javascript,python,java,ruby,php";

const TODO_MARKER_RE = /\b(TODO|FIXME)\b/i;

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

const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "shell",
] as const;

interface PkgJson {
  scripts?: Record<string, string>;
}

function readPkg(root: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PkgJson;
  } catch {
    return null;
  }
}

/** Repo-pinned binary first, PATH fallback (no downloads inside a check). */
function toolBin(root: string, name: string): string {
  const local = join(root, "node_modules", ".bin", name);
  try {
    if (existsSync(local)) return local;
  } catch {
    /* fall through to PATH */
  }
  return name;
}

function relToRoot(root: string, file: string): string {
  const f = file.trim();
  if (!f) return f;
  if (f.startsWith(`${root}/`)) return f.slice(root.length + 1);
  try {
    return relative(root, join(root, f));
  } catch {
    return f;
  }
}

/**
 * Which checks apply to root. Linter/tool presence comes from
 * detectProject (single source of truth shared with scaffolding);
 * tsconfig + test script are direct FS reads.
 */
export function applicableChecks(root: string): CheckId[] {
  const report = detectProject(root);
  const out: CheckId[] = [];
  if (report.existing.eslint || report.existing.biome || report.existing.oxlint) {
    out.push("lint");
  }
  try {
    if (existsSync(join(root, "tsconfig.json"))) out.push("typecheck");
  } catch {
    /* ignore */
  }
  if (typeof readPkg(root)?.scripts?.["test"] === "string") out.push("tests");
  if (report.existing.knip) out.push("knip");
  if (report.existing.jscpd) out.push("jscpd");
  if (report.languages.some((l) => (CODE_LANGUAGES as readonly string[]).includes(l))) {
    out.push("todo");
  }
  // Pure FS — no tool detection can make it inapplicable.
  out.push("scratchpad");
  return out;
}

// ---------------------------------------------------------------------------
// Parsers (pure — unit tested against live tool output shapes)
// ---------------------------------------------------------------------------

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

// ---- knip ----

export interface KnipFinding {
  kind: "file" | "export" | "dependency" | "issue";
  file: string;
  name: string;
  line?: number;
}

const KNIP_KIND_KEYS = [
  "files",
  "exports",
  "dependencies",
  "devDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "types",
  "duplicates",
] as const;

function knipItemName(item: unknown): { name: string; line?: number; } {
  if (typeof item === "string") return { name: item };
  const o = item as { name?: unknown; symbol?: unknown; specifier?: unknown; line?: unknown; };
  const name = typeof o.name === "string" && o.name
    ? o.name
    : typeof o.symbol === "string" && o.symbol
    ? o.symbol
    : typeof o.specifier === "string" && o.specifier
    ? o.specifier
    : JSON.stringify(item).slice(0, 80);
  const line = typeof o.line === "number" ? o.line : undefined;
  if (line !== undefined) return { name, line };
  return { name };
}

/** Singular display kind for a knip issue key. */
function knipKind(key: string): KnipFinding["kind"] {
  if (key === "files") return "file";
  if (key === "exports") return "export";
  if (key === "dependencies" || key === "devDependencies" || key === "unlisted") {
    return "dependency";
  }
  return "issue";
}

/**
 * Parse `knip --reporter json`. Handles the `{issues: [...]}` shape plus
 * the legacy keyed shape, tolerating string/object items.
 */
export function parseKnipIssues(data: unknown): KnipFinding[] {
  const out: KnipFinding[] = [];
  const pushItems = (key: string, items: unknown, file: string) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const { name, line } = knipItemName(item);
      if (!name) continue;
      const finding: KnipFinding = { kind: knipKind(key), file, name };
      if (line !== undefined) finding.line = line;
      out.push(finding);
    }
  };
  const root = data as { issues?: unknown; };
  if (Array.isArray(root?.issues)) {
    for (const raw of root.issues) {
      const issue = raw as { file?: unknown; } & Record<string, unknown>;
      const file = typeof issue.file === "string" ? issue.file : "";
      for (const key of KNIP_KIND_KEYS) pushItems(key, issue[key], file);
    }
    return out;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of KNIP_KIND_KEYS) pushItems(key, obj[key], "");
  }
  return out;
}

// ---- jscpd ----

export interface CloneFinding {
  a: string;
  lineA: number;
  b: string;
  lineB: number;
  lines: number;
}

/**
 * Parse a jscpd JSON report (`{duplicates: [...]}`). Empty duplicates
 * yields []; missing shape throws.
 */
export function parseJscpdReport(data: unknown): CloneFinding[] {
  const dups = (data as { duplicates?: unknown; })?.duplicates;
  if (!Array.isArray(dups)) throw new Error("jscpd: unexpected report shape");
  const out: CloneFinding[] = [];
  for (const raw of dups) {
    const d = raw as {
      firstFile?: { name?: unknown; startLoc?: { line?: unknown; }; };
      secondFile?: { name?: unknown; startLoc?: { line?: unknown; }; };
      lines?: unknown;
    };
    const a = typeof d.firstFile?.name === "string" ? d.firstFile.name : "";
    const b = typeof d.secondFile?.name === "string" ? d.secondFile.name : "";
    const lineA = typeof d.firstFile?.startLoc?.line === "number" ? d.firstFile.startLoc.line : 0;
    const lineB = typeof d.secondFile?.startLoc?.line === "number" ? d.secondFile.startLoc.line : 0;
    const lines = typeof d.lines === "number" ? d.lines : 0;
    if (!a || !b) continue;
    out.push({ a, lineA, b, lineB, lines });
  }
  return out;
}

// ---- todo ----

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

// ---------------------------------------------------------------------------
// Runners (spawn tools; best-effort, never throw on findings)
// ---------------------------------------------------------------------------

export interface SpawnFn {
  (
    cmd: string[],
    cwd: string,
  ):
    | { exitCode: number; stdout: string; stderr: string; }
    | Promise<{ exitCode: number; stdout: string; stderr: string; }>;
}

async function defaultSpawn(
  cmd: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

/** Cap an output tail for error fields (keeps JSON reports small). */
function tail(text: string, max = 500): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `…${clean.slice(-max)}` : clean;
}

function toFindings(
  items: Array<{ file: string; line: number; rule: string; message: string; error: boolean; }>,
): CheckFinding[] {
  return items.slice(0, CHECK_MAX_FINDINGS).map((f) => ({
    file: f.file,
    line: f.line,
    rule: f.rule,
    message: f.message,
    severity: f.error ? ("error" as const) : ("warning" as const),
    kind: f.error ? ("bug" as const) : ("task" as const),
  }));
}

async function runLint(root: string, spawn: SpawnFn): Promise<CheckResult> {
  const base = { id: "lint" as const, tool: "", ok: true, findings: [] as CheckFinding[] };
  let report: ReturnType<typeof detectProject>;
  try {
    report = detectProject(root);
  } catch (e) {
    return { ...base, ok: false, error: `detection failed: ${(e as Error).message}` };
  }
  const tool = report.existing.eslint
    ? "eslint"
    : report.existing.biome
    ? "biome"
    : report.existing.oxlint
    ? "oxlint"
    : null;
  if (!tool) return { ...base, tool: "none", skipped: "no linter configured" };
  const bin = toolBin(root, tool);
  const argv = tool === "eslint"
    ? [bin, "--format", "json", "."]
    : tool === "oxlint"
    ? [bin, "--format", "json", "."]
    : [bin, "check", "--max-diagnostics=30", "."];
  const res = await spawn(argv, root);
  const out = res.stdout;
  try {
    const findings = tool === "eslint"
      ? parseEslintJson(out, root)
      : tool === "oxlint"
      ? parseOxlintJson(out, root)
      : parseBiomeOutput(out, root);
    return { ...base, tool, findings: toFindings(findings) };
  } catch (e) {
    if (res.exitCode === 0 || !out.trim()) return { ...base, tool, findings: [] };
    return {
      ...base,
      tool,
      ok: false,
      error: `${tool} failed: ${(e as Error).message} — ${tail(res.stderr || out)}`,
    };
  }
}

async function runTypecheck(root: string, spawn: SpawnFn): Promise<CheckResult> {
  const base = {
    id: "typecheck" as const,
    tool: "tsc --noEmit",
    ok: true,
    findings: [] as CheckFinding[],
  };
  const res = await spawn([toolBin(root, "tsc"), "--noEmit", "-p", root], root);
  const out = res.stdout + res.stderr;
  const errors = parseTscOutput(out, root);
  if (errors.length > 0) {
    return {
      ...base,
      findings: errors.slice(0, CHECK_MAX_FINDINGS).map((e) => ({
        file: e.file,
        line: e.line,
        rule: e.code,
        message: e.message,
        severity: "error" as const,
        kind: "bug" as const,
      })),
    };
  }
  if (res.exitCode !== 0) {
    return {
      ...base,
      ok: false,
      error: `tsc exited ${res.exitCode} with no parseable errors — ${tail(out)}`,
    };
  }
  return base;
}

async function runTests(
  root: string,
  testCommand: string,
  spawn: SpawnFn,
): Promise<CheckResult> {
  const words = testCommand.split(/\s+/).filter(Boolean);
  const base = {
    id: "tests" as const,
    tool: words.join(" "),
    ok: true,
    findings: [] as CheckFinding[],
  };
  if (words.length === 0) return { ...base, ok: false, error: "empty test command" };
  const res = await spawn(words, root);
  const out = res.stdout + res.stderr;
  const failures = parseTestOutput(out);
  if (failures.length > 0) {
    return {
      ...base,
      findings: failures.slice(0, CHECK_MAX_FINDINGS).map((f) => ({
        file: "",
        line: 0,
        rule: "test",
        message: f.name,
        severity: "error" as const,
        kind: "bug" as const,
      })),
    };
  }
  if (res.exitCode !== 0) {
    return {
      ...base,
      ok: false,
      error: `test command exited ${res.exitCode} with no parseable failures — ${tail(out)}`,
    };
  }
  return base;
}

async function runKnip(root: string, spawn: SpawnFn): Promise<CheckResult> {
  const base = { id: "knip" as const, tool: "knip", ok: true, findings: [] as CheckFinding[] };
  const res = await spawn(
    [
      toolBin(root, "knip"),
      "--reporter",
      "json",
      "-n",
      "-D",
      root,
      "--include",
      "files,exports,dependencies,devDependencies",
    ],
    root,
  );
  let data: unknown;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    if (res.exitCode === 0 || !res.stdout.trim()) return base;
    return { ...base, ok: false, error: `knip failed: ${tail(res.stderr || res.stdout)}` };
  }
  const findings = parseKnipIssues(data);
  return {
    ...base,
    findings: findings.slice(0, CHECK_MAX_FINDINGS).map((f) => ({
      file: f.file,
      line: f.line ?? 0,
      rule: `knip:${f.kind}`,
      message: `${f.kind}: ${f.name}`,
      severity: (f.kind === "issue" ? "error" : "warning") as CheckSeverity,
      kind: (f.kind === "issue" ? "bug" : "task") as "bug" | "task",
    })),
  };
}

async function runJscpd(root: string, spawn: SpawnFn): Promise<CheckResult> {
  const base = { id: "jscpd" as const, tool: "jscpd", ok: true, findings: [] as CheckFinding[] };
  const outDir = mkdtempSync(join(tmpdir(), "giwt-doctor-jscpd-"));
  try {
    const cfg = join(root, ".jscpd.json");
    // NOTE: no --exit-code flag — its spelling differs across jscpd
    // versions (--exit-code vs --exitCode) and the exit code is ignored
    // here anyway: findings come from the report file, not the status.
    const res = await spawn(
      [
        toolBin(root, "jscpd"),
        "--silent",
        "-r",
        "json",
        "-o",
        outDir,
        "-f",
        JSCPD_FORMATS,
        ...(existsSync(cfg) ? ["-c", cfg] : []),
        root,
      ],
      root,
    );
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(outDir, "jscpd-report.json"), "utf8"));
    } catch {
      return {
        ...base,
        ok: false,
        error: `jscpd produced no report (exit ${res.exitCode}) — ${tail(res.stderr)}`,
      };
    }
    return {
      ...base,
      // Configs may report absolute paths ("absolute": true) — relativize.
      findings: parseJscpdReport(data)
        .slice(0, CHECK_MAX_FINDINGS)
        .map((c) => {
          const a = relToRoot(root, c.a);
          const b = relToRoot(root, c.b);
          return {
            file: a,
            line: c.lineA,
            rule: "duplication",
            message: `${c.lines} duplicated lines: ${a}:${c.lineA} ↔ ${b}:${c.lineB}`,
            severity: "warning" as const,
            kind: "task" as const,
          };
        }),
    };
  } finally {
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* scratch cleanup is best-effort */
    }
  }
}

function runTodo(root: string): CheckResult {
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
    findings: matches.slice(0, CHECK_MAX_FINDINGS).map((m) => ({
      file: relative(root, m.file),
      line: m.line,
      rule: m.marker,
      message: m.text || "(no description)",
      severity: (m.marker === "FIXME" ? "error" : "warning") as CheckSeverity,
      kind: (m.marker === "FIXME" ? "bug" : "task") as "bug" | "task",
    })),
  };
}

// ---- scratchpad ----

const SCRATCHPAD_MIB = 1024 * 1024;
const SCRATCHPAD_DAY_MS = 24 * 60 * 60 * 1000;

/** MB with one decimal — the unit every scratchpad size message/note uses. */
function formatScratchMb(bytes: number): string {
  return `${(bytes / SCRATCHPAD_MIB).toFixed(1)} MB`;
}

/** Settings-derived inputs for the scratchpad check, threaded by
 *  runDoctorChecks (defaults apply when absent). */
export interface ScratchpadCheckOptions {
  config: ScratchConfig;
  thresholds: ScratchpadThresholds;
  /** Scratch root relative to the checked repo root (settings.scratch.root). */
  rootDir: string;
}

/**
 * `doctor scratchpad` — scratchpad bloat report. Strictly read-only: it
 * reuses scanScratch() as its only data source and never deletes anything
 * (pruning is `giwt clean`'s job). `scratchRoot` is the already-resolved
 * scan root (repo root + rootDir). The findings are repo-health numbers
 * rather than per-file defects, so `file` is the scratch dir itself (".").
 * Errors gate (checkExitCode 1), warnings report only; notes carry the raw
 * numbers plus the top-5 largest directories. Missing scratch dir is a
 * clean skip, not a finding.
 */
export function runScratchpad(
  scratchRoot: string,
  cfg: ScratchConfig,
  thresholds: ScratchpadThresholds,
  nowMs: number = Date.now(),
): CheckResult {
  const base = {
    id: "scratchpad" as const,
    tool: "scratchpad",
    ok: true,
    findings: [] as CheckFinding[],
  };
  if (!existsSync(scratchRoot)) {
    return { ...base, skipped: `no scratchpad dir at ${scratchRoot}` };
  }
  const scan = scanScratch(scratchRoot, cfg, nowMs);
  // Orphan metric is the tmp class as a whole — aged candidates plus the
  // not-yet-aged keeps — i.e. every plain *.tmp spill scanScratch saw.
  const tmpClass = scan.classes.find((c) => c.name === "tmp");
  const orphans = tmpClass ? tmpClass.keep.length + tmpClass.candidates.length : 0;

  const items: Array<{
    file: string;
    line: number;
    rule: string;
    message: string;
    error: boolean;
  }> = [];
  if (scan.totalBytes > thresholds.errorMb * SCRATCHPAD_MIB) {
    items.push({
      file: ".",
      line: 0,
      rule: "scratchpad:size",
      message: `scratchpad is ${
        formatScratchMb(scan.totalBytes)
      } (threshold ${thresholds.errorMb} MB)`,
      error: true,
    });
  } else if (scan.totalBytes > thresholds.warnMb * SCRATCHPAD_MIB) {
    items.push({
      file: ".",
      line: 0,
      rule: "scratchpad:size",
      message: `scratchpad is ${
        formatScratchMb(scan.totalBytes)
      } (threshold ${thresholds.warnMb} MB)`,
      error: false,
    });
  }
  if (orphans > thresholds.orphanWarn) {
    items.push({
      file: ".",
      line: 0,
      rule: "scratchpad:orphans",
      message: `${orphans} orphan *.tmp files (threshold ${thresholds.orphanWarn})`,
      error: true,
    });
  }
  if (scan.oldestMtimeMs !== null) {
    const ageDays = (nowMs - scan.oldestMtimeMs) / SCRATCHPAD_DAY_MS;
    if (ageDays > thresholds.oldestWarnDays) {
      items.push({
        file: ".",
        line: 0,
        rule: "scratchpad:age",
        message: `oldest artifact is ${ageDays.toFixed(1)} days old`
          + ` (threshold ${thresholds.oldestWarnDays} days)`,
        error: false,
      });
    }
  }

  const notes = [
    `total ${formatScratchMb(scan.totalBytes)}`,
    `orphans: ${orphans} *.tmp file(s)`,
  ];
  notes.push(
    scan.oldestMtimeMs === null
      ? "oldest artifact: none"
      : `oldest artifact: ${((nowMs - scan.oldestMtimeMs) / SCRATCHPAD_DAY_MS).toFixed(1)} days`,
  );
  notes.push(
    ...largestDirs(scratchRoot, 5).map((d) => `${d.path} — ${formatScratchMb(d.bytes)}`),
  );
  return { ...base, findings: toFindings(items), notes };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** Default max concurrent checks — bounds peak memory on big projects
 *  (tests, tsc, knip, jscpd each spawn their own heavy toolchain). */
export const DOCTOR_JOBS_DEFAULT = 4;

export interface DoctorCheckOptions {
  /** Subset of checks to run. Undefined = all applicable. */
  checks?: CheckId[];
  /** Test command words override (defaults to settings.commands.test). */
  testCommand?: string;
  /** Max checks executing concurrently (integer >= 1; default 4). */
  jobs?: number;
  /** Spawn injector (tests stub tools without subprocesses). */
  spawn?: SpawnFn;
  /** Scratchpad check inputs (settings-derived). When absent the check uses
   *  DEFAULT_SCRATCH_CONFIG / DEFAULT_SCRATCHPAD_THRESHOLDS and rootDir
   *  ".tmp". */
  scratch?: ScratchpadCheckOptions;
}

/**
 * Run the requested health checks against root. Throws on a nonexistent
 * root (matches detectProject) and on a `jobs` value that is not an
 * integer >= 1; per-check failures are captured in the report, never
 * thrown.
 *
 * Checks execute through a bounded worker pool of at most `jobs`
 * concurrent tasks — the safe default (4) keeps peak memory bounded on
 * big projects where tests + tsc + knip + jscpd each spawn heavy
 * toolchains. The report preserves the requested check order regardless
 * of completion order.
 */
export async function runDoctorChecks(
  root: string,
  opts: DoctorCheckOptions = {},
  testCommand = "bun run test:unit",
): Promise<DoctorCheckReport> {
  const jobs = opts.jobs ?? DOCTOR_JOBS_DEFAULT;
  if (!Number.isInteger(jobs) || jobs < 1) {
    throw new Error(`doctor check: jobs must be an integer >= 1 (got ${jobs})`);
  }
  const applicable = new Set(applicableChecks(root));
  const wanted = opts.checks ?? CHECK_IDS;
  const spawn = opts.spawn ?? defaultSpawn;
  const ids = wanted.filter((id): id is CheckId => (CHECK_IDS as readonly string[]).includes(id));
  const checks: CheckResult[] = new Array(ids.length);
  const tasks: Array<{
    at: number;
    run: () => CheckResult | Promise<CheckResult>;
  }> = [];
  const skipped = (id: CheckId, tool: string, reason: string): CheckResult => ({
    id,
    tool,
    ok: true,
    skipped: reason,
    findings: [],
  });
  ids.forEach((id, at) => {
    if (!applicable.has(id)) {
      checks[at] = skipped(id, id, "not applicable to this project");
      return;
    }
    switch (id) {
      case "lint":
        tasks.push({ at, run: () => runLint(root, spawn) });
        break;
      case "typecheck":
        tasks.push({ at, run: () => runTypecheck(root, spawn) });
        break;
      case "tests":
        tasks.push({
          at,
          run: () => runTests(root, opts.testCommand ?? testCommand, spawn),
        });
        break;
      case "knip":
        tasks.push({ at, run: () => runKnip(root, spawn) });
        break;
      case "jscpd":
        tasks.push({ at, run: () => runJscpd(root, spawn) });
        break;
      case "todo":
        tasks.push({ at, run: () => runTodo(root) });
        break;
      case "scratchpad":
        tasks.push({
          at,
          run: () =>
            runScratchpad(
              join(root, opts.scratch?.rootDir ?? ".tmp"),
              opts.scratch?.config ?? DEFAULT_SCRATCH_CONFIG,
              opts.scratch?.thresholds ?? DEFAULT_SCRATCHPAD_THRESHOLDS,
            ),
        });
        break;
    }
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      checks[task.at] = await task.run();
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker));
  return { version: 1, root, checks };
}

/** Exit code for a report: 1 on any error finding or failed check. */
export function checkExitCode(report: DoctorCheckReport): number {
  for (const check of report.checks) {
    if (!check.ok && check.skipped === undefined) return 1;
    if (check.findings.some((f) => f.severity === "error")) return 1;
  }
  return 0;
}
