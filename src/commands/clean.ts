// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt clean` — age/size-capped pruning of the scratchpad under
 * `<worktreeRoot>/<settings.scratch.root>` (default `.tmp`).
 *
 * Dry-run is the default: the per-class prune plan is printed and nothing
 * is deleted. `--apply` removes the candidates (files plain, cov-* dirs
 * recursively) and reports bytes freed. `--json` makes the raw JSON
 * payload the only stdout content — the run-record announce and every
 * log() line stay off stdout (same isolation as `doctor check --json`,
 * ticket FIX-json-output-polluted-by-run-record-announcement).
 *
 * All scanning lives in utils/scratch.ts, shared with the planned `doctor
 * scratchpad` check. Deletion failures are collected per artifact, the
 * rest of the plan still runs, and the command sets process.exitCode = 1
 * (NOT process.exit) so run-record outcome/ledger hooks still fire.
 */

import { existsSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config.ts";
import { log, raw } from "../utils/output.ts";
import { activeRun } from "../utils/runlog.ts";
import { scanScratch } from "../utils/scratch.ts";
import type { ScratchClass, ScratchScan } from "../utils/scratch.ts";

interface CleanOptions {
  apply: boolean;
  json: boolean;
  verbose: boolean;
}

interface DeleteFailure {
  path: string;
  error: string;
}

/** 1024-based human bytes, one decimal below 100 of a unit ("0 B",
 *  "112 B", "1.1 MB", "112 KB", "1.3 GB"). */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n;
  let i = -1;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]!}`;
}

function printHelp(): void {
  raw("Usage: giwt clean [--dry-run] [--apply] [--json] [--verbose]");
  raw("  --dry-run   print the prune plan per class (default; nothing is deleted)");
  raw("  --apply     run the prune and report bytes freed");
  raw("  --json      machine-readable plan/result on stdout");
  raw("  --verbose   list every candidate path, not just per-class totals");
}

/** Raw string[] parsing in the doctor.ts style: no values, flags only.
 *  --apply/--dry-run override each other, last occurrence wins. Unknown
 *  flags exit hard (process.exit) — there is no partial plan worth
 *  recording for a typo'd invocation. */
function parseArgs(args: string[]): CleanOptions {
  const out: CleanOptions = { apply: false, json: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.apply = false;
    else if (a === "--json") out.json = true;
    else if (a === "--verbose") out.verbose = true;
    else {
      log("error", `unknown flag '${a}'`);
      raw("  Usage: giwt clean [--dry-run] [--apply] [--json] [--verbose]");
      process.exit(1);
    }
  }
  return out;
}

/** Delete one scanned candidate. Directories (cov-*) go recursively;
 *  files are unlinked plain. A candidate that vanished since the scan
 *  throws here and is collected by the caller. */
function removeCandidate(path: string): void {
  const st = lstatSync(path);
  if (st.isDirectory()) {
    rmSync(path, { recursive: true });
    return;
  }
  rmSync(path);
}

function classBytes(cls: ScratchClass): number {
  return cls.candidates.reduce((sum, e) => sum + e.bytes, 0);
}

function printPlan(scan: ScratchScan, verbose: boolean): void {
  for (const cls of scan.classes) {
    raw(`   ${cls.name}: ${cls.candidates.length} file(s), ${humanBytes(classBytes(cls))}`);
    if (!verbose) continue;
    for (const e of cls.candidates) {
      raw(`     ${e.path}`);
    }
  }
  raw(`   total: ${scan.totalCandidateCount} file(s), ${humanBytes(scan.totalCandidateBytes)}`);
}

function jsonPayload(
  scan: ScratchScan,
  apply: boolean,
  freedBytes: number,
  freedCount: number,
  failures: DeleteFailure[],
): string {
  return JSON.stringify(
    {
      root: scan.root,
      apply,
      totalCandidateBytes: scan.totalCandidateBytes,
      totalCandidateCount: scan.totalCandidateCount,
      totalBytes: scan.totalBytes,
      oldestMtimeMs: scan.oldestMtimeMs,
      classes: scan.classes.map((cls) => ({
        name: cls.name,
        candidateCount: cls.candidates.length,
        candidateBytes: classBytes(cls),
        candidates: cls.candidates,
        keepCount: cls.keep.length,
      })),
      ...(apply ? { freedBytes, freedCount, failures } : {}),
    },
    null,
    2,
  );
}

/** Apply the plan: delete every candidate, collect (never abandon on)
 *  failures, keep the freed accounting exact even when some deletions
 *  fail. Returns the collected failures. */
function applyPlan(
  scan: ScratchScan,
): {
  freedBytes: number;
  freedCount: number;
  failures: DeleteFailure[];
  perClass: Map<string, { bytes: number; count: number; }>;
} {
  const failures: DeleteFailure[] = [];
  let freedBytes = 0;
  let freedCount = 0;
  const perClass = new Map<string, { bytes: number; count: number; }>();
  for (const cls of scan.classes) {
    let bytes = 0;
    let count = 0;
    for (const e of cls.candidates) {
      try {
        removeCandidate(e.path);
        freedBytes += e.bytes;
        freedCount++;
        bytes += e.bytes;
        count++;
      } catch (err) {
        failures.push({
          path: e.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    perClass.set(cls.name, { bytes, count });
  }
  return { freedBytes, freedCount, failures, perClass };
}

export async function clean(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const opts = parseArgs(args);
  const scratch = config.settings.scratch;
  const root = join(config.worktreeRoot, scratch.root);
  // scanScratch itself zero-scans a missing root, so the same code path
  // serves missing and empty scratchpads.
  const scan = scanScratch(root, {
    tmpMaxAgeDays: scratch.tmpMaxAgeDays,
    lcovKeepLatest: scratch.lcovKeepLatest,
    jscpdMaxAgeDays: scratch.jscpdMaxAgeDays,
    checkReportKeep: scratch.checkReportKeep,
  });

  if (!opts.json && !existsSync(root)) {
    log("info", `no scratchpad at ${root} — nothing to clean`);
    return;
  }

  if (!opts.apply) {
    activeRun()?.outcome({
      clean: `dry-run: ${scan.totalCandidateCount} artifact(s), ${
        humanBytes(scan.totalCandidateBytes)
      }`,
    });
    if (opts.json) {
      raw(jsonPayload(scan, false, 0, 0, []));
      return;
    }
    printPlan(scan, opts.verbose);
    log("info", "Dry-run only — pass --apply to delete these artifacts");
    return;
  }

  const applied = applyPlan(scan);
  const summary = `freed ${humanBytes(applied.freedBytes)} across ${applied.freedCount} artifact(s)`
    + (applied.failures.length > 0 ? ` (${applied.failures.length} failed)` : "");
  activeRun()?.outcome({ clean: summary });
  if (opts.json) {
    raw(jsonPayload(scan, true, applied.freedBytes, applied.freedCount, applied.failures));
  } else {
    for (const cls of scan.classes) {
      const stat = applied.perClass.get(cls.name);
      if (!stat || stat.count === 0) continue;
      raw(`   ${cls.name}: freed ${humanBytes(stat.bytes)} across ${stat.count} file(s)`);
    }
    log("success", summary);
  }
  if (applied.failures.length > 0) {
    // log() routes to stderr even under --json — the JSON payload stays
    // the only stdout content. exitCode (not exit) lets the run record
    // and ledger finalize normally.
    for (const f of applied.failures) {
      log("error", `failed to delete ${f.path}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}
