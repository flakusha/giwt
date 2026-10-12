// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt report --profile` — which gate is actually costing time, answered from
 * the reports the runner already writes. Generalizes loop-lore's throwaway
 * `.tmp/mine-gates.ts`: same aggregation, but over every worktree's report
 * instead of one directory's per-run files, and wired into the CLI.
 *
 * Ranking is by DISTINCT runs that saw the gate fail or time out (one worktree
 * reporting the same gate twice is one run, not two), so a repo with many
 * worktrees cannot inflate a gate's rank by repetition.
 */

import { type OutFormat, renderRecords } from "../utils/emit.ts";
import { colorize, raw } from "../utils/output.ts";
import type { NormalizedReport } from "./report-parse.ts";

export interface ProfileInput {
  /** Worktree name, or "(main)". */
  name: string;
  report: NormalizedReport;
}

export interface GateProfile {
  gate: string;
  /** Distinct runs in the window that ran this gate at all. */
  runs: number;
  /** Distinct runs in the window where it failed or timed out. */
  failingRuns: number;
  failures: number;
  timeouts: number;
  advisory: number;
  skipped: number;
  passed: number;
  /** durationMs samples observed (0 for legacy writers that record none). */
  samples: number;
  medianMs: number | null;
  p90Ms: number | null;
  maxMs: number | null;
}

export interface GateProfileResult {
  since: string | null;
  /** Reports inside the window (undated reports count — see profileGates). */
  reports: number;
  /** Reports kept despite having no parseable timestamp. */
  undatedReports: number;
  /** Failing gates only, most-failing first. */
  gates: GateProfile[];
  /** Gates present in the window that never failed or timed out. */
  cleanGates: number;
}

interface Bucket {
  runs: Set<string>;
  failingRuns: Set<string>;
  failures: number;
  timeouts: number;
  advisory: number;
  skipped: number;
  passed: number;
  durations: number[];
}

function fmtMs(n: number | null): string {
  if (n === null) return "n/a";
  return n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`;
}

/** Nearest-rank quantile on a pre-sorted array; n === 0 → null. */
function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx] ?? null;
}

/**
 * Aggregate gate outcomes across reports.
 *
 * `since` (an ISO string, already validated by the caller) filters on the
 * report timestamp. A report with no parseable timestamp is KEPT (and counted
 * in `undatedReports`): dropping it would let a timestamp-less report hide a
 * real failure, which is the one thing a failure profile must never do.
 */
export function profileGates(
  inputs: ProfileInput[],
  since: string | null,
): GateProfileResult {
  const sinceMs = since === null ? null : Date.parse(since);
  const buckets = new Map<string, Bucket>();
  let reports = 0;
  let undatedReports = 0;

  for (const { name, report } of inputs) {
    const at = Date.parse(report.generatedAt);
    if (!Number.isFinite(at)) undatedReports++;
    else if (sinceMs !== null && at < sinceMs) continue;
    reports++;
    // One (worktree, runId) pair is one run; a report that never ran has no id.
    const runKey = `${name}::${report.runId}`;
    for (const gate of report.gates) {
      let bucket = buckets.get(gate.name);
      if (bucket === undefined) {
        bucket = {
          runs: new Set(),
          failingRuns: new Set(),
          failures: 0,
          timeouts: 0,
          advisory: 0,
          skipped: 0,
          passed: 0,
          durations: [],
        };
        buckets.set(gate.name, bucket);
      }
      bucket.runs.add(runKey);
      if (gate.status === "failed" || gate.status === "timedOut") {
        bucket.failingRuns.add(runKey);
      }
      if (gate.status === "failed") bucket.failures++;
      else if (gate.status === "timedOut") bucket.timeouts++;
      else if (gate.status === "advisory") bucket.advisory++;
      else if (gate.status === "skipped") bucket.skipped++;
      else if (gate.status === "passed") bucket.passed++;
      if (gate.durationMs !== undefined) bucket.durations.push(gate.durationMs);
    }
  }

  const all: GateProfile[] = [...buckets.entries()].map(([gate, b]) => {
    const durations = [...b.durations].sort((x, y) => x - y);
    const medianMs = quantile(durations, 0.5);
    const p90Ms = quantile(durations, 0.9);
    return {
      gate,
      runs: b.runs.size,
      failingRuns: b.failingRuns.size,
      failures: b.failures,
      timeouts: b.timeouts,
      advisory: b.advisory,
      skipped: b.skipped,
      passed: b.passed,
      samples: durations.length,
      medianMs,
      p90Ms,
      maxMs: durations.length === 0 ? null : durations[durations.length - 1]!,
    };
  });

  const failing = all.filter((g) => g.failingRuns > 0).sort(
    (a, b) => b.failingRuns - a.failingRuns || a.gate.localeCompare(b.gate),
  );
  return {
    since,
    reports,
    undatedReports,
    gates: failing,
    cleanGates: all.length - failing.length,
  };
}

function profileEmoji(record: Record<string, unknown> | unknown): string {
  const rec = record as GateProfileResult;
  return `❌ ${rec.gates.map((g) => `${g.gate} (${g.failingRuns} run(s))`).join(" · ")}`;
}

function printProfileHuman(result: GateProfileResult): void {
  const window = result.since === null ? "all time" : `since ${result.since}`;
  raw(
    `Gate failure profile — ${result.reports} report(s), ${window}`,
  );
  if (result.undatedReports > 0) {
    raw(
      `  (${result.undatedReports} report(s) carried no parseable timestamp and were kept)`,
    );
  }
  if (result.gates.length === 0) {
    raw(`  ${colorize("no failing gates", "green")} in the window`);
  }
  for (const g of result.gates) {
    const counts = `fail ${g.failures}  timeout ${g.timeouts}  advisory ${g.advisory}`
      + `  skipped ${g.skipped}  passed ${g.passed}`;
    const timing = g.maxMs === null ? "" : `  |  median ${fmtMs(g.medianMs)}`
      + `  p90 ${fmtMs(g.p90Ms)}  max ${fmtMs(g.maxMs)}`;
    raw(
      `  ${colorize(`${g.failingRuns} run(s)`, "red")} ${g.gate} — ${counts}${timing}`,
    );
  }
  if (result.cleanGates > 0) {
    raw(`  ${result.cleanGates} other gate(s) never failed in the window`);
  }
  raw("");
}

/** Human table by default; --json/--toml/--emoji emit the same facts. */
export function printProfile(result: GateProfileResult, format: OutFormat): void {
  if (format === "human") {
    printProfileHuman(result);
    return;
  }
  raw(renderRecords(result, format, { emoji: profileEmoji }));
}
