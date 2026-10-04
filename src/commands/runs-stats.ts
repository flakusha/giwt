// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt runs stats` — aggregate the run records `giwt` already writes.
 *
 * Read-only: no new records, no schema change. Every field comes from
 * meta.json (cmd/args/start/end/exitCode/outcome.failedGates) through the
 * shared listRuns() reader, so the aggregate cannot drift from the records it
 * summarizes.
 *
 * Pure functions over RunMeta[] — split from runs.ts for the 250L production
 * file budget (AGENTS.md).
 */

import { type WorktreeConfig } from "../utils/config";
import { type OutFormat, renderRecords, renderTable } from "../utils/emit";
import { colorize, log, raw } from "../utils/output";
import { listRuns, type RunMeta } from "../utils/runlog";

/** A run record as returned by listRuns() (meta fields plus its dir). */
export type RunRecord = RunMeta & { dir: string; };

/** Per-command rollup over a window of run records. */
export interface CommandStats {
  cmd: string;
  runs: number;
  /** Finished with a non-zero exitCode. Records with no exitCode are
   *  unfinished, not failures — counted separately. */
  failed: number;
  /** No exitCode at all: killed before the exit hook wrote one. */
  unfinished: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
}

/** Aggregate emitted for every output format. */
export interface StatsSummary {
  totalRuns: number;
  windowStart: string | null;
  windowEnd: string | null;
  commands: CommandStats[];
  failingGates: Array<{ gate: string; count: number; }>;
  repeated: Array<{ invocation: string; count: number; }>;
}

/** Mutable tally accumulated in one pass over the records. */
interface CommandTally {
  runs: number;
  failed: number;
  unfinished: number;
  durations: number[];
}

function fmtMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

/** Roll records up per command. Exported for tests: every output format
 *  funnels through it, so asserting its result covers the arithmetic. */
export function summarize(records: RunRecord[]): StatsSummary {
  const byCmd = new Map<string, CommandTally>();
  const gateCounts = new Map<string, number>();
  const invocations = new Map<string, number>();
  let minStart: string | null = null;
  let maxStart: string | null = null;

  for (const record of records) {
    const entry = byCmd.get(record.cmd)
      ?? { runs: 0, failed: 0, unfinished: 0, durations: [] };
    entry.runs++;
    if (record.exitCode === undefined) entry.unfinished++;
    else if (record.exitCode !== 0) entry.failed++;

    if (record.start && record.end) {
      const delta = Date.parse(record.end) - Date.parse(record.start);
      if (Number.isFinite(delta) && delta >= 0) entry.durations.push(delta);
    }
    byCmd.set(record.cmd, entry);

    for (const gate of record.outcome?.failedGates ?? []) {
      gateCounts.set(gate, (gateCounts.get(gate) ?? 0) + 1);
    }

    const invocation = `${record.cmd} ${(record.args ?? []).join(" ")}`.trimEnd();
    invocations.set(invocation, (invocations.get(invocation) ?? 0) + 1);

    if (typeof record.start === "string") {
      if (minStart === null || record.start < minStart) minStart = record.start;
      if (maxStart === null || record.start > maxStart) maxStart = record.start;
    }
  }

  const commands = [...byCmd]
    .map(([cmd, t]) => {
      const sorted = [...t.durations].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      return {
        cmd,
        runs: t.runs,
        failed: t.failed,
        unfinished: t.unfinished,
        meanMs: sorted.length === 0
          ? 0
          : Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
        p95Ms: sorted[idx] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
      };
    })
    .sort((a, b) => b.runs - a.runs || a.cmd.localeCompare(b.cmd));

  return {
    totalRuns: records.length,
    windowStart: minStart,
    windowEnd: maxStart,
    commands,
    failingGates: [...gateCounts]
      .map(([gate, count]) => ({ gate, count }))
      .sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate)),
    repeated: [...invocations]
      .filter(([, count]) => count > 1)
      .map(([invocation, count]) => ({ invocation, count }))
      .sort((a, b) => b.count - a.count || a.invocation.localeCompare(b.invocation)),
  };
}

/** Emoji line: `cmd xN`. Guards the untyped record shape renderRecords hands
 *  us rather than asserting one. */
function emojiLine(record: Record<string, unknown> | unknown): string {
  if (typeof record !== "object" || record === null) return String(record);
  if ("cmd" in record && "runs" in record) {
    return `${String(record.cmd)} x${String(record.runs)}`;
  }
  return JSON.stringify(record);
}

function human(summary: StatsSummary, capNote: string): void {
  const rows: string[][] = [
    ["command", "runs", "failed", "unfinished", "fail%", "mean", "p95", "max"],
  ];
  for (const c of summary.commands) {
    rows.push([
      c.cmd,
      String(c.runs),
      c.failed > 0 ? colorize(String(c.failed), "red") : "0",
      String(c.unfinished),
      c.runs === 0 ? "0.0" : ((c.failed / c.runs) * 100).toFixed(1),
      fmtMs(c.meanMs),
      fmtMs(c.p95Ms),
      fmtMs(c.maxMs),
    ]);
  }
  raw(renderTable(rows));

  if (summary.failingGates.length > 0) {
    raw("");
    raw(
      `  failing gates (${summary.failingGates.length} distinct, from outcome.failedGates):`,
    );
    for (const { gate, count } of summary.failingGates.slice(0, 10)) {
      raw(`    ${String(count).padStart(4)}  ${gate}`);
    }
  }
  if (summary.repeated.length > 0) {
    raw("");
    raw("  repeated invocations (identical cmd+args):");
    for (const { invocation, count } of summary.repeated.slice(0, 10)) {
      raw(`    x${String(count).padStart(3)}  ${invocation}`);
    }
  }
  raw("");
  const span = summary.windowStart === null
    ? ""
    : ` ${summary.windowStart} .. ${summary.windowEnd}`;
  raw(`  ${summary.totalRuns} run record(s) in window${span}`);
  if (capNote !== "") raw(`  ${capNote} — not lifetime totals.`);
}

/**
 * `giwt runs stats [--last N]` — the aggregate view over the same records
 * `giwt runs` lists. Report only: never gates, never changes the exit code.
 */
export function stats(
  { args, config, format }: { args: string[]; config: WorktreeConfig; format: OutFormat; },
): void {
  const cap = config.settings.runlog.maxRuns;
  let last = cap;
  // Accepts both `--last N` and `--last=N`, matching the parent `giwt runs`
  // parser and the usage string it shares.
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    let value = Number.NaN;
    if (arg === "--last") {
      value = Number.parseInt(args[++i] ?? "", 10);
    } else if (arg.startsWith("--last=")) {
      value = Number.parseInt(arg.slice("--last=".length), 10);
    }
    if (Number.isFinite(value) && value > 0) {
      last = value;
    } else {
      log("error", `unknown flag '${arg}'`);
      raw(" Usage: giwt runs stats [--last N] [--json|--toml|--emoji]");
      process.exit(1);
    }
  }

  const summary = summarize(listRuns(config, last));
  if (summary.totalRuns === 0) {
    log("info", "No run records");
    return;
  }
  if (format === "human") {
    human(summary, last === cap ? `window capped at ${cap} records ([runlog].maxRuns)` : "");
    return;
  }
  // Emoji is one line per command; json/toml carry the whole aggregate.
  const payload = format === "emoji" ? summary.commands : summary;
  raw(renderRecords(payload, format, { emoji: emojiLine }));
}
