// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Durable backup state: an append-only JSONL ledger (`.backup.jsonl`, sibling
 * of `.ledger.jsonl`) recording per-remote backup events. Appends are a single
 * write + fsync; the file is never rewritten in place, so concurrent agents
 * can append without torn records (a killed writer leaves a partial line that
 * readers skip, like the shared ledger).
 *
 * Event shape (ticket-specified fields plus `ok`/`note`):
 * { ts, kind: dump|sync|copy|verify|alert, remote, path, type: full|incr,
 *   size, sha256, verifiedAt, offsiteAt, ok, note }
 * `kind: "alert"` records staleness alerts (ticket: "noted in ledger as
 * alerts") — they never count as successes.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

export const STATE_FILENAME = ".backup.jsonl";

export type BackupKind = "dump" | "sync" | "copy" | "verify" | "alert";
export type BackupType = "full" | "incr";

export interface BackupEvent {
  ts: string;
  kind: BackupKind;
  remote: string;
  path: string;
  type?: BackupType;
  size?: number;
  sha256?: string;
  verifiedAt?: string;
  offsiteAt?: string;
  ok: boolean;
  note?: string;
}

/** Absolute path of the state ledger for a tree dir. */
export function statePath(treeDir: string): string {
  return join(treeDir, STATE_FILENAME);
}

/**
 * Append one event: open-once, single write, fsync before close. The fsync
 * is the durability contract — a "failed" beacon must survive the crash that
 * caused it, or staleness lies. If a previous writer died mid-line, the
 * partial tail is sealed with a newline first, so the new event lands whole
 * (the corrupt fragment stays and readers skip it).
 */
export function appendState(treeDir: string, event: BackupEvent): void {
  const path = statePath(treeDir);
  let line = `${JSON.stringify(event)}\n`;
  if (existsSync(path) && statSync(path).size > 0 && !endsWithNewline(path)) {
    line = `\n${line}`;
  }
  const fd = openSync(path, "a");
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function endsWithNewline(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, statSync(path).size - 1);
    return buf[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}

/** Read all well-formed events; partial/corrupt tail lines are skipped. */
export function readState(treeDir: string): BackupEvent[] {
  const path = statePath(treeDir);
  if (!existsSync(path)) return [];
  const events: BackupEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as BackupEvent;
      if (
        typeof parsed.ts === "string" && typeof parsed.kind === "string"
        && typeof parsed.ok === "boolean"
      ) {
        events.push(parsed);
      }
    } catch {
      /* partial tail or corrupt line — skip, like the shared ledger */
    }
  }
  return events;
}

/** Events that count as a completed unit of work for staleness/`status`. */
export function successes(
  events: readonly BackupEvent[],
  kind: BackupKind,
  remote?: string,
): BackupEvent[] {
  return events.filter((e) =>
    e.ok === true && e.kind === kind && (remote === undefined || e.remote === remote)
  );
}

/** Timestamp of the last success for one kind (+optional remote), or null. */
export function lastSuccessMs(
  events: readonly BackupEvent[],
  kind: BackupKind,
  remote?: string,
): number | null {
  const stamps = successes(events, kind, remote).map((e) => Date.parse(e.ts));
  return stamps.length === 0 ? null : Math.max(...stamps);
}

/** Parse a staleness duration (`30s`/`10m`/`24h`/`7d`); null when invalid. */
export function parseDuration(input: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (match === null) return null;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as "s" | "m" | "h" | "d"
  ];
  return Number(match[1]) * unit;
}

export interface StalenessVerdict {
  fresh: boolean;
  ageMs: number | null;
}

/** Pure staleness verdict: null history is stale (never backed up). */
export function stalenessVerdict(
  lastMs: number | null,
  now: number,
  maxAgeMs: number,
): StalenessVerdict {
  if (lastMs === null) return { fresh: false, ageMs: null };
  const ageMs = Math.max(0, now - lastMs);
  return { fresh: ageMs < maxAgeMs, ageMs };
}

/**
 * Staleness gate for `backup status`: returns the alert note or null. The
 * caller warns on non-null and exits 1 under --strict (cron-visible).
 */
export function stalenessAlert(
  events: readonly BackupEvent[],
  now: number,
  maxAgeMs: number,
): string | null {
  const last = lastSuccessMs(events, "dump");
  const verdict = stalenessVerdict(last, now, maxAgeMs);
  if (verdict.fresh) return null;
  if (verdict.ageMs === null) return "no successful dump on record";
  const hours = (verdict.ageMs / 3_600_000).toFixed(1);
  return `last successful dump is ${hours}h old (staleness budget ${
    (maxAgeMs / 3_600_000).toFixed(1)
  }h)`;
}

/** One `kind remote → timestamp` row for the status table. */
export function lastSuccessRow(
  events: readonly BackupEvent[],
  kind: BackupKind,
  remote: string,
): string {
  const last = lastSuccessMs(events, kind, remote);
  const label = remote === "" ? "(local)" : remote;
  return last === null
    ? `  ${kind} ${label}: never`
    : `  ${kind} ${label}: ${new Date(last).toISOString()}`;
}
