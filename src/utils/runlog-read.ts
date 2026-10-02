// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Read-side helpers for run records (events, listing, outcome rendering),
 * split out of runlog.ts for size. Re-exported from runlog.ts.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type WorktreeConfig } from "./config";
import { type RunEvent, type RunMeta, type RunOutcome, runsRoot } from "./runlog-types";

/**
 * Read one run's structured step events in write order. Corrupt rows are
 * skipped, so a torn last line (process killed mid-append) costs the tail
 * and nothing else. Empty when the run recorded no events.
 */
export function readRunEvents(dir: string): RunEvent[] {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "events.jsonl"), "utf8");
  } catch {
    return [];
  }
  const out: RunEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as RunEvent;
      if (parsed && parsed.v === 1 && typeof parsed.step === "string") out.push(parsed);
    } catch { /* skip corrupt row */ }
  }
  return out;
}

/**
 * Read run records newest-first. Corrupt/missing meta.json rows are
 * skipped; `last` caps the result (default 20).
 */
export function listRuns(
  config: WorktreeConfig,
  last = 20,
): Array<RunMeta & { dir: string; }> {
  const root = runsRoot(config);
  if (!existsSync(root)) return [];
  const out: Array<RunMeta & { dir: string; }> = [];
  try {
    const names = readdirSync(root).sort().toReversed();
    for (const name of names) {
      const dir = join(root, name);
      try {
        const parsed = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as RunMeta;
        if (parsed && parsed.v === 1 && typeof parsed.cmd === "string") {
          out.push({ ...parsed, dir });
        }
      } catch { /* skip corrupt row */ }
      if (out.length >= last) break;
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * Compact one-line human rendering of a run outcome, for `giwt runs`.
 *
 * @param outcome - outcome summary from meta.json
 * @returns "; "-joined summary, or "" when the record has no outcome data
 */
export function formatOutcome(outcome: RunOutcome | undefined): string {
  if (!outcome) return "";
  const parts: string[] = [];
  if (outcome.failedGates && outcome.failedGates.length > 0) {
    parts.push(`failed: ${outcome.failedGates.join(",")}`);
  }
  if (outcome.mergeCommit) parts.push(`merged: ${outcome.mergeCommit.slice(0, 9)}`);
  if (outcome.sync) {
    parts.push(
      `sync: ${outcome.sync.fixesApplied} fixed, ${outcome.sync.issuesRemaining} remaining`
        + (outcome.sync.advisoryRemaining > 0
          ? ` (${outcome.sync.advisoryRemaining} advisory)`
          : ""),
    );
  }
  if (outcome.doctor) parts.push(`doctor: ${outcome.doctor}`);
  if (outcome.clean) parts.push(`clean: ${outcome.clean}`);
  if (outcome.tmp) parts.push(`tmp: ${outcome.tmp}`);
  return parts.join("; ");
}
