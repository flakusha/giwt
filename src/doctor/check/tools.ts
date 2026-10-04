// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tool-backed checks: knip (unused exports/deps) and jscpd (copy-paste
 * clones) — their JSON report parsers plus the spawn runners.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnFn } from "./spawn.ts";
import { tail } from "./spawn.ts";
import {
  capFindings,
  type CheckFinding,
  type CheckResult,
  type CheckSeverity,
} from "./types.ts";
import { relToRoot, toolBin } from "./util.ts";

/** jscpd languages passed via -f (verified to exist; unknown names fail the run). */
const JSCPD_FORMATS = "typescript,javascript,python,java,ruby,php";

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
  if (res.timedOut) return { ...base, ok: false, error: res.timedOut };
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
    ...capFindings(findings.map((f) => ({
      file: f.file,
      line: f.line ?? 0,
      rule: `knip:${f.kind}`,
      message: `${f.kind}: ${f.name}`,
      severity: (f.kind === "issue" ? "error" : "warning") as CheckSeverity,
      kind: (f.kind === "issue" ? "bug" : "task") as "bug" | "task",
    }))),
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
    if (res.timedOut) return { ...base, ok: false, error: res.timedOut };
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
      ...capFindings(parseJscpdReport(data).map((c) => {
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
      })),
    };
  } finally {
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* scratch cleanup is best-effort */
    }
  }
}

export { runJscpd, runKnip };
