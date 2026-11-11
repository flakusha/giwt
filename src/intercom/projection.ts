// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * The WHO-DOES-WHAT projection — derived, never hand-edited.
 *
 * `giwt intercom ls` computes the board from the store's claim files
 * (FIELD-STUDY §1.6: hand-maintained manifests rotted; deriving kills the
 * rot). A lane is DONE when a same-stem FIXED file exists, ACTIVE when a
 * LANE file has none, and STALE when it has been active longer than
 * `laneStaleDays` — the stem-drift problem from the field study is bounded
 * by matching on exact stems, which is the CLI's own naming contract.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIXED_PREFIX, LANE_PREFIX, STALE_MARK } from "./types";

export type LaneStatus = "active" | "done" | "stale";

export interface LaneRow {
  lane: string;
  status: LaneStatus;
  /** Claim owner (`owner=` line), or "?" for orphan FIXED reports. */
  owner: string;
  /** Age in whole days of the newest file for the lane. */
  ageDays: number;
  /** True when gc stamped the claim stale. */
  staleStamped: boolean;
}

function headerField(path: string, field: string): string {
  try {
    const line = readFileSync(path, "utf8").split("\n").find((l) => l.startsWith(`${field}=`));
    return line?.slice(field.length + 1).trim() ?? "";
  } catch {
    return "";
  }
}

function ageDaysOf(path: string, nowMs: number): number {
  try {
    return Math.max(0, Math.floor((nowMs - statSync(path).mtimeMs) / (24 * 60 * 60 * 1000)));
  } catch {
    return 0;
  }
}

/** Age of a claim/report from its `date=` header, falling back to mtime.
 *  The header — not mtime — is the staleness clock: gc's stale stamp
 *  rewrites the file and would otherwise reset its own verdict. */
function ageDaysOfEntry(path: string, nowMs: number): number {
  const date = headerField(path, "date");
  if (date.length > 0) {
    const ms = Date.parse(date.endsWith("Z") ? date : `${date}Z`);
    if (!Number.isNaN(ms)) {
      return Math.max(0, Math.floor((nowMs - ms) / (24 * 60 * 60 * 1000)));
    }
  }
  return ageDaysOf(path, nowMs);
}

/**
 * Build the lane board from the store directory. Read-only: missing or
 * unreadable files are skipped, never thrown (concurrent gc may move a
 * file mid-read).
 */
export function projectLanes(
  storeDir: string,
  staleDays: number,
  nowMs: number = Date.now(),
): LaneRow[] {
  let names: string[];
  try {
    names = readdirSync(storeDir);
  } catch {
    return [];
  }
  const lanes = new Set<string>();
  const fixedNoLane: string[] = [];
  for (const name of names) {
    if (name.startsWith(LANE_PREFIX) && name.endsWith(".md")) {
      lanes.add(name.slice(LANE_PREFIX.length, -".md".length));
    } else if (name.startsWith(FIXED_PREFIX) && name.endsWith(".md")) {
      const stem = name.slice(FIXED_PREFIX.length, -".md".length);
      if (lanes.has(stem)) continue;
      fixedNoLane.push(stem);
      lanes.add(stem);
    }
  }
  const rows: LaneRow[] = [];
  for (const lane of lanes) {
    const lanePath = join(storeDir, `${LANE_PREFIX}${lane}.md`);
    const fixedPath = join(storeDir, `${FIXED_PREFIX}${lane}.md`);
    const claimed = existsSync(lanePath);
    const done = existsSync(fixedPath);
    let stamped = false;
    try {
      stamped = claimed && readFileSync(lanePath, "utf8").includes(STALE_MARK);
    } catch {
      stamped = false;
    }
    // The staleness clock is the CLAIM's age (date header, mtime fallback) —
    // gc's stamp rewrites the file and must not reset its own verdict. For
    // orphan FIXED reports (no claim file) the report's own age is used.
    const agePath = claimed ? lanePath : fixedPath;
    const ageDays = existsSync(agePath) ? ageDaysOfEntry(agePath, nowMs) : 0;
    const owner = claimed
      ? headerField(lanePath, "owner") || "?"
      : headerField(fixedPath, "owner") || "?";
    const status: LaneStatus = done ? "done" : ageDays >= staleDays || stamped ? "stale" : "active";
    rows.push({ lane, status, owner, ageDays, staleStamped: stamped });
  }
  return rows.sort((a, b) => a.lane.localeCompare(b.lane));
}
