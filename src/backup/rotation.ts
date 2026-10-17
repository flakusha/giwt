// SPDX-License-Identifier: AGPL-3-0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * GFS/keep-N rotation selection (pure). Archives are bucketed by UTC day,
 * ISO week, and month; the newest archive of each of the N newest buckets
 * per granularity is kept, everything outside the union is prune-eligible.
 * A zero budget disables that granularity entirely. One archive can satisfy
 * several classes (the newest archive of the newest month is usually also
 * the newest daily/weekly) — the union is what survives.
 */

import { type BackupArchive, stampMs } from "./plan";

export interface RotationPolicy {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
}

export interface RotationPlan {
  /** Archives to keep, oldest first. */
  keep: BackupArchive[];
  /** Archives prune-eligible under the policy, oldest first. */
  prune: BackupArchive[];
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** ISO-8601 week (Monday-based) so weekly buckets align across years. */
function weekKey(ms: number): string {
  const d = new Date(ms);
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const thursday = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - dayNum + 3,
  );
  const t = new Date(thursday);
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week1Monday = Date.UTC(
    jan4.getUTCFullYear(),
    0,
    4 - ((jan4.getUTCDay() + 6) % 7),
  );
  const week = 1 + Math.round((thursday - week1Monday) / (7 * 86_400_000));
  return `${t.getUTCFullYear()}-W${pad2(week)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Newest archive per bucket key, keys sorted ascending (zero-padded, so
 *  lexicographic = chronological for every key shape above). */
function newestPerBucket(
  sorted: BackupArchive[],
  keyOf: (ms: number) => string,
): Array<[string, BackupArchive]> {
  const buckets = new Map<string, BackupArchive>();
  for (const a of sorted) buckets.set(keyOf(stampMs(a.stamp)), a);
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Select the keep/prune split for one target's archives under the policy.
 * Fewer archives than a budget keeps all of them for that class; a budget
 * of 0 (or less) disables that granularity entirely. `pinned` archives
 * (the live chain: youngest full + its incrementals) always survive —
 * pruning a base under open incrementals would orphan the chain.
 */
export function selectRotation(
  { archives, policy, pinned }: {
    archives: BackupArchive[];
    policy: RotationPolicy;
    /** Archive names that survive any budget (the live chain). */
    pinned?: ReadonlySet<string>;
  },
): RotationPlan {
  const sorted = [...archives].sort((a, b) => stampMs(a.stamp) - stampMs(b.stamp));
  const keep = new Set<string>();
  const classes: Array<[keyof RotationPolicy, (ms: number) => string]> = [
    ["keepDaily", dayKey],
    ["keepWeekly", weekKey],
    ["keepMonthly", monthKey],
  ];
  for (const [budgetKey, keyOf] of classes) {
    const budget = Math.max(0, Math.floor(policy[budgetKey]));
    if (budget === 0) continue;
    for (const [, archive] of newestPerBucket(sorted, keyOf).slice(-budget)) {
      keep.add(archive.archive);
    }
  }
  const survives = (a: BackupArchive): boolean =>
    keep.has(a.archive) || pinned?.has(a.archive) === true;
  return {
    keep: sorted.filter(survives),
    prune: sorted.filter((a) => !survives(a)),
  };
}
