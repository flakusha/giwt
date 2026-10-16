// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Finalize Step 6a — prune the scratchpad of the worktree that is about to be
 * removed. AGENTS.md tells agents to delete `.tmp/` before finalizing; the rule
 * was documented, not enforced, so it was consistently ignored.
 *
 * This calls the SAME `scanScratch` that `giwt clean` and `doctor scratchpad`
 * use — no second pruner, no new scratch class, no new config key. The four
 * classes stay exactly as they are (tmp / lcov / jscpd / check-report); what
 * they do not cover is REPORTED as unclassified, never silently widened.
 *
 * Safe by construction: the scanner walks with lstat and skips symlinks, so a
 * symlinked path inside the scratchpad is never a delete candidate, and
 * nothing outside the worktree's scratch root is ever touched. Deletion
 * failures are collected, never thrown — a scratchpad that cannot be pruned
 * must not fail an otherwise-complete finalize.
 */

import { existsSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";
import { activeRun } from "../../utils/runlog";
import { largestDirs, scanScratch, type ScratchEntry } from "../../utils/scratch";
import { humanBytes } from "../clean";

export interface ScratchPruneResult {
  root: string;
  /** False when the worktree had no scratchpad at all (nothing to report). */
  existed: boolean;
  dryRun: boolean;
  candidateCount: number;
  candidateBytes: number;
  freedCount: number;
  freedBytes: number;
  /** Bytes under the root the four classes do not cover — never deleted. */
  unclassifiedBytes: number;
  failures: Array<{ path: string; error: string; }>;
}

interface PruneOptions {
  wtPath: string;
  config: WorktreeConfig;
  dryRun: boolean;
}

/** Delete one candidate: directories (cov-*) recursively, files plain.
 *  `force` so a file another process removed between scan and delete reads as
 *  "already gone" instead of a prune failure. */
function removeCandidate(path: string): void {
  if (lstatSync(path).isDirectory()) {
    rmSync(path, { recursive: true, force: true });
    return;
  }
  rmSync(path, { force: true });
}

function reportUnclassified(
  root: string,
  scan: { totalBytes: number; totalCandidateBytes: number; },
): void {
  const unclassified = Math.max(0, scan.totalBytes - scan.totalCandidateBytes);
  if (unclassified === 0) return;
  const top = largestDirs(root, 3)
    .map((d) => `${d.path.slice(root.length + 1)} (${humanBytes(d.bytes)})`)
    .join(", ");
  raw(
    `   note: ${humanBytes(unclassified)} under this root is outside the 4 scratch classes`
      + ` (tmp/lcov/jscpd/check-report) and was NOT pruned${top ? ` — largest: ${top}` : ""}`,
  );
}

/**
 * Scan the worktree's scratch root and apply the plan. With `dryRun` the plan
 * is printed and nothing is deleted.
 */
export function pruneWorktreeScratch({ wtPath, config, dryRun }: PruneOptions): ScratchPruneResult {
  const scratch = config.settings.scratch;
  const root = join(wtPath, scratch.root);
  const empty: ScratchPruneResult = {
    root,
    existed: false,
    dryRun,
    candidateCount: 0,
    candidateBytes: 0,
    freedCount: 0,
    freedBytes: 0,
    unclassifiedBytes: 0,
    failures: [],
  };
  if (!existsSync(root)) {
    log("info", `Step 6a: no scratchpad at ${root} — nothing to prune`);
    return empty;
  }
  // The walker skips symlinks INSIDE the root, but a symlinked ROOT itself is
  // followed: its candidates are another checkout's files, and deleting them
  // would delete outside this worktree. Refuse before the scan, not after.
  if (lstatSync(root).isSymbolicLink()) {
    log("warn", `Step 6a: scratch root ${root} is a symlink — refusing to prune through it`);
    return { ...empty, existed: true };
  }

  const scan = scanScratch(root, scratch);
  log("info", `Step 6a: Pruning scratchpad at ${root}...`);
  for (const cls of scan.classes) {
    if (cls.candidates.length === 0) continue;
    const bytes = cls.candidates.reduce((sum: number, e: ScratchEntry) => sum + e.bytes, 0);
    raw(`   ${cls.name}: ${cls.candidates.length} artifact(s), ${humanBytes(bytes)}`);
  }
  raw(
    `   total: ${scan.totalCandidateCount} artifact(s), ${humanBytes(scan.totalCandidateBytes)}`
      + ` (of ${humanBytes(scan.totalBytes)} under this root)`,
  );
  reportUnclassified(root, scan);

  const result: ScratchPruneResult = {
    ...empty,
    existed: true,
    candidateCount: scan.totalCandidateCount,
    candidateBytes: scan.totalCandidateBytes,
    unclassifiedBytes: Math.max(0, scan.totalBytes - scan.totalCandidateBytes),
  };
  if (dryRun) {
    log("info", "Step 6a: --prune-dry-run — scratchpad left untouched");
    return result;
  }

  const failures = result.failures;
  for (const cls of scan.classes) {
    for (const entry of cls.candidates) {
      try {
        removeCandidate(entry.path);
        result.freedBytes += entry.bytes;
        result.freedCount++;
      } catch (err) {
        failures.push({
          path: entry.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  const summary =
    `freed ${humanBytes(result.freedBytes)} across ${result.freedCount} scratch artifact(s)`
    + (failures.length > 0 ? ` (${failures.length} failed)` : "");
  activeRun()?.outcome({ scratch: summary });
  log("success", `Step 6a: ${summary}`);
  return result;
}
