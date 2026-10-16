// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt runs` list-side query filters + machine projection
 * (FEAT-runs-json-diet-default-projection-and-query-filters).
 *
 * The default projection is lean: `{ cmd, branch, start, end, exitCode,
 * outcome, dir, argsSummary }` — no per-run event arrays and no raw argv
 * (the sampled run's args embedded an entire multi-paragraph ticket
 * body). `--events` re-adds the lazy events.jsonl join; `--full`
 * restores the pre-diet byte shape (`{...meta, dir, events}`). meta.json
 * on disk is unchanged — this is purely the read projection.
 *
 * `--cmd`/`--branch`/`--failed` select runs and compose with `--last`:
 * filtering happens first, the `--last` cap applies to matching runs.
 */

import { readRunEvents } from "../utils/runlog";
import { type RunMeta } from "../utils/runlog-types";

export type RunRecord = RunMeta & { dir: string; };

/** Args summary shape: first 3 args, each capped at 80 chars. */
const ARG_SUMMARY_COUNT = 3;
const ARG_SUMMARY_CHARS = 80;

export interface RunQueryFlags {
  /** Cap applied AFTER filtering (default 20). */
  last: number;
  /** Exact command-name match (`--cmd finalize`). */
  cmd?: string;
  /** Exact branch match (`--branch <b>`). */
  branch?: string;
  /** exitCode ≠ 0 (missing counts — abnormal) or outcome.failedGates set. */
  failed: boolean;
  /** Re-add the per-run events join. */
  events: boolean;
  /** Restore the full pre-diet record (raw args + events). */
  full: boolean;
}

export type RunQuery = RunQueryFlags | { problem: string; };

type ScanValue = boolean | string | string[] | undefined;

function selector(value: ScanValue): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function count(value: ScanValue): number | null {
  if (value === undefined) return 20;
  if (typeof value !== "string") return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Build the query from a scanFlags result (runs.ts owns the scan). */
export function parseRunQuery(flags: Record<string, ScanValue>): RunQuery {
  const last = count(flags["--last"]);
  if (last === null) return { problem: "--last requires a positive integer" };
  if (flags["--cmd"] === true) return { problem: "--cmd requires a command name" };
  if (flags["--branch"] === true) return { problem: "--branch requires a branch name" };
  const cmd = selector(flags["--cmd"]);
  const branch = selector(flags["--branch"]);
  return {
    last,
    ...(cmd !== undefined ? { cmd } : {}),
    ...(branch !== undefined ? { branch } : {}),
    failed: flags["--failed"] === true,
    events: flags["--events"] === true,
    full: flags["--full"] === true,
  };
}

/** Failure predicate shared by the `--failed` filter and stats. */
export function isFailedRun(record: RunRecord): boolean {
  return record.exitCode !== 0 || (record.outcome?.failedGates?.length ?? 0) > 0;
}

/** Apply --cmd/--branch/--failed; caller slices to the --last cap. */
export function filterRuns(records: RunRecord[], query: RunQueryFlags): RunRecord[] {
  return records.filter((record) => {
    if (query.cmd !== undefined && record.cmd !== query.cmd) return false;
    if (query.branch !== undefined && record.branch !== query.branch) return false;
    if (query.failed && !isFailedRun(record)) return false;
    return true;
  });
}

function capArg(arg: string): string {
  return arg.length > ARG_SUMMARY_CHARS ? arg.slice(0, ARG_SUMMARY_CHARS) : arg;
}

/** The read projection for one run record (see module doc). */
export function projectRun(record: RunRecord, query: RunQueryFlags): Record<string, unknown> {
  if (query.full) {
    return { ...record, events: readRunEvents(record.dir) };
  }
  const summary = record.args.slice(0, ARG_SUMMARY_COUNT).map(capArg);
  const truncated = Math.max(0, record.args.length - ARG_SUMMARY_COUNT);
  return {
    cmd: record.cmd,
    branch: record.branch,
    start: record.start,
    ...(record.end !== undefined ? { end: record.end } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record.outcome !== undefined ? { outcome: record.outcome } : {}),
    dir: record.dir,
    argsSummary: summary,
    ...(truncated > 0 ? { argsTruncated: truncated } : {}),
    ...(query.events ? { events: readRunEvents(record.dir) } : {}),
  };
}
