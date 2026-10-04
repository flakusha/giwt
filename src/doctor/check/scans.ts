// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure-FS scan checks: leaks (test openers without teardown) and
 * scratchpad (.tmp bloat report).
 */

import { existsSync } from "node:fs";
import {
  largestDirs,
  scanScratch,
  type ScratchConfig,
  type ScratchpadThresholds,
} from "../../utils/scratch.ts";
import { OPENER_TEARDOWN_METHODS, scanLeaks } from "../leaks.ts";
import { toFindings } from "./spawn.ts";
import { capFindings, type CheckFinding, type CheckResult } from "./types.ts";

/**
 * `leaks` — test files opening resources (createTestDb, Bun.spawn) with no
 * teardown. Pure FS scan via scanLeaks; findings are hygiene warnings
 * (kind "task"), so ok stays true and the exit code is unaffected —
 * mirroring how non-FIXME todo findings behave.
 */
export function runLeaks(root: string): CheckResult {
  const base = {
    id: "leaks" as const,
    tool: "leak-scan",
    ok: true,
    findings: [] as CheckFinding[],
  };
  return {
    ...base,
    ...capFindings(
      scanLeaks(root).map((m) => {
        const teardowns = OPENER_TEARDOWN_METHODS[m.opener]
          .map((t) => `${m.var}.${t}()`)
          .join("/");
        return {
          file: m.file,
          line: m.line,
          rule: `leaks:${m.opener}`,
          message: `${m.opener}() bound to '${m.var}' is never torn down — no ${teardowns}, `
            + `no afterAll/afterEach/t.cleanup usage`,
          severity: "warning" as const,
          kind: "task" as const,
        };
      }),
    ),
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
  return { ...base, ...toFindings(items), notes };
}
