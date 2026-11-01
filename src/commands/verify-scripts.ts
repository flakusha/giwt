// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Discovery + execution engine for `giwt verify` (command surface in
 * ./verify.ts — the history.ts → history-detectors.ts size-budget split).
 *
 * Scripts are repo-owned executables, so discovery is config-driven:
 * `[verify] scripts` in giwt.toml holds repo-root-relative glob-ish
 * patterns (`*`/`?` within one path segment) or plain directories; when
 * unset/empty the documented convention defaults `.tmp/verify*` and
 * `scripts/verify*` apply. Only executable regular files run —
 * non-executable and hidden entries are skipped and symlinks are never
 * followed — deduplicated and sorted by path so a run is deterministic.
 * Scripts execute SEQUENTIALLY with cwd = repo root (parallel fan-out is
 * a doctor-check concern; these are the user's own repo scripts).
 *
 * Execution reuses the doctor spawn seam: each child is raced against the
 * budget and KILLED when it wins, reported as a timeout naming the script
 * and the budget — a wedged script can never hang the run. Output is
 * surfaced as a last-lines tail capped by `[output] stream_tail` on failure.
 */

import { lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  boundedSpawn,
  defaultSpawn,
  type SpawnFn,
  type SpawnResult,
} from "../doctor/check/spawn.ts";
import { log } from "../utils/output.ts";

/** Convention defaults when [verify] scripts is unset/empty (USAGE-documented). */
export const DEFAULT_SCRIPT_PATTERNS: readonly string[] = [".tmp/verify*", "scripts/verify*"];

/** One executed script. `path` is repo-root-relative (stable identity and sort key); `exitCode` is -1 on timeout, mirroring SpawnResult. */
export interface ScriptResult {
  name: string;
  path: string;
  status: "pass" | "fail" | "timeout";
  exitCode: number;
  durationMs: number;
  /** Last [output] stream_tail lines (fail/timeout only). */
  outputTail?: string;
}

/** Machine payload + aggregation basis for the verify outcome line. */
export interface VerifyReport {
  scripts: ScriptResult[];
  passed: number;
  failed: number;
  total: number;
  ok: boolean;
  /** The applied per-script budget (echoed under --json). */
  timeoutMs: number;
}

export interface VerifyRunOptions {
  /** Repo root: discovery base and every script's cwd. */
  root: string;
  /** Repo-root-relative script paths, in execution order. */
  scripts: string[];
  timeoutMs: number;
  /** Tail cap in lines ([output] stream_tail). */
  tailLines: number;
  /** Test seam: replaces boundedSpawn(defaultSpawn, …). */
  spawn?: SpawnFn;
}

// ── Discovery ────────────────────────────────────────────────────────────

function globToRegExp(segment: string): RegExp {
  let source = "";
  for (const ch of segment) {
    if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += ".";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function isExecutableFile(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function safeLstat(path: string): { isDirectory(): boolean; isFile(): boolean; } | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Executable regular files under dir (recursive); hidden entries and symlinks are never followed (dirent types + lstat, TOCTOU-bounded). */
function collectDir(root: string, dir: string, rel: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    const child = join(root, childRel);
    if (entry.isDirectory()) collectDir(root, child, childRel, out);
    else if (isExecutableFile(child)) out.push(childRel);
  }
}

/** One pattern against one repo root: matched repo-root-relative paths.
 *  Absolute patterns and `..` segments are refused with a warn (patterns
 *  must stay inside the repo). */
function matchPattern(root: string, pattern: string): string[] {
  const segments = pattern.split("/").filter((s) => s.length > 0 && s !== ".");
  if (pattern.startsWith("/") || segments.includes("..")) {
    log("warn", `[verify] scripts pattern '${pattern}' must stay inside the repo — skipped`);
    return [];
  }
  let frontier: Array<{ abs: string; rel: string; }> = [{ abs: root, rel: "" }];
  for (const segment of segments) {
    const re = globToRegExp(segment);
    // Hidden entries are skipped under wildcard segments only — a literal
    // segment may name a hidden dir (the convention default uses .tmp/).
    const wildcard = segment.includes("*") || segment.includes("?");
    const next: typeof frontier = [];
    for (const node of frontier) {
      let entries;
      try {
        entries = readdirSync(node.abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (wildcard && entry.name.startsWith(".")) continue;
        if (!re.test(entry.name)) continue;
        next.push({
          abs: join(node.abs, entry.name),
          rel: node.rel === "" ? entry.name : `${node.rel}/${entry.name}`,
        });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  const hits: string[] = [];
  for (const node of frontier) {
    const st = safeLstat(node.abs);
    if (st === null) continue;
    if (st.isDirectory()) collectDir(root, node.abs, node.rel, hits);
    else if (st.isFile() && isExecutableFile(node.abs)) hits.push(node.rel);
  }
  return hits;
}

/** All executable scripts matching the patterns: deduplicated by path,
 *  sorted deterministically (repo-root-relative, lexicographic). */
export function discoverScripts(root: string, patterns: string[]): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const rel of matchPattern(root, pattern)) {
      if (!seen.has(rel)) {
        seen.add(rel);
        found.push(rel);
      }
    }
  }
  return found.sort();
}

// ── Name filtering (exact name or unique prefix) ─────────────────────────

/** Exact-basename or unique-prefix selection over script names (the
 *  plan-interconnect ref idiom: exact first, then a prefix resolving to
 *  exactly one script; ambiguous/unknown is an error naming the filter
 *  and every discovered name). */
export function selectScripts(
  relPaths: string[],
  filters: string[],
): { selected: string[]; error: string | null; } {
  const available = relPaths.map((p) => basename(p)).join(", ") || "none";
  const selected: string[] = [];
  for (const filter of filters) {
    const exact = relPaths.filter((p) => basename(p) === filter);
    const matches = exact.length > 0
      ? exact
      : relPaths.filter((p) => basename(p).startsWith(filter));
    if (matches.length === 1) {
      const only = matches[0]!;
      if (!selected.includes(only)) selected.push(only);
      continue;
    }
    if (matches.length === 0) {
      return { selected: [], error: `no verify script matches '${filter}' (found: ${available})` };
    }
    return {
      selected: [],
      error:
        `'${filter}' matches ${matches.length} scripts — name one exactly (found: ${available})`,
    };
  }
  return { selected, error: null };
}

// ── Execution ────────────────────────────────────────────────────────────

/** Last `max` lines of combined stdout+stderr; a notice marks dropped lines (the [output] stream_tail contract). */
function outputTail(res: SpawnResult, max: number): string | null {
  const text = [res.stdout, res.stderr].filter((s) => s.length > 0).join("\n").replace(/\s+$/, "");
  if (text.length === 0) return null;
  const lines = text.split("\n");
  const tail = lines.slice(-max);
  const dropped = lines.length - tail.length;
  return (dropped > 0 ? `… ${dropped} earlier line(s) dropped\n` : "") + tail.join("\n");
}

/** Run each script sequentially under the bounded spawn seam; aggregate
 *  pass/fail/timeout into the report. A timeout kills the child (whole
 *  process group via the seam's detached spawn), names script+budget, and
 *  merges the killed child's captured streams, so the tail reports partial
 *  output on fail AND timeout — grace-bounded: in-group streams close on
 *  SIGKILL and settle promptly; an escaped process holding the pipes open
 *  falls back to the empty timeout result. */
export async function runVerifyScripts(opts: VerifyRunOptions): Promise<VerifyReport> {
  const spawn = opts.spawn ?? boundedSpawn(defaultSpawn, opts.timeoutMs);
  const results: ScriptResult[] = [];
  for (const rel of opts.scripts) {
    const abs = join(opts.root, rel);
    const started = performance.now();
    let res: SpawnResult;
    try {
      res = await spawn([abs], opts.root);
    } catch (error) {
      // posix_spawn rejects (ENOEXEC/ENOENT) for an unexecutable file —
      // garbage bytes, missing shebang interpreter. One bad script must
      // degrade to a failed entry, never crash the run.
      res = { exitCode: 126, stdout: "", stderr: (error as Error).message };
    }
    const durationMs = Math.round(performance.now() - started);
    const tail = res.timedOut !== undefined || res.exitCode !== 0
      ? outputTail(res, opts.tailLines)
      : null;
    results.push({
      name: basename(rel),
      path: rel,
      status: res.timedOut !== undefined ? "timeout" : res.exitCode === 0 ? "pass" : "fail",
      exitCode: res.exitCode,
      durationMs,
      ...(tail !== null ? { outputTail: tail } : {}),
    });
  }
  const failed = results.filter((r) => r.status !== "pass").length;
  return {
    scripts: results,
    passed: results.length - failed,
    failed,
    total: results.length,
    ok: failed === 0,
    timeoutMs: opts.timeoutMs,
  };
}
