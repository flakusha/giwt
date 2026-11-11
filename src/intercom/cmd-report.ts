// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt intercom ls` / `giwt intercom read` — the polling surface.
 *
 * `ls` prints the derived WHO-DOES-WHAT board (never a shared hand-edited
 * file); `read` dumps the event tail or a store file for agents that want
 * raw bytes. Both are strictly read-only and ledger-silent.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { renderRecords } from "../utils/emit";
import { raw } from "../utils/output";
import { backendFor } from "./backend";
import { type LaneRow, projectLanes } from "./projection";
import { resolveExistingStore } from "./store";
import type { IntercomEvent } from "./types";

export interface LsOptions {
  staleOnly: boolean;
  format: "human" | "json" | "toml" | "emoji";
}

const STATUS_PAD = 6;

function laneRecord(r: LaneRow): Record<string, unknown> {
  return {
    lane: r.lane,
    status: r.status,
    owner: r.owner,
    ageDays: r.ageDays,
    staleStamped: r.staleStamped,
  };
}

function laneEmoji(record: unknown): string {
  const r = record as LaneRow;
  const mark = r.status === "done" ? "✅" : r.status === "stale" ? "🕰️" : "🚧";
  return `${mark} ${r.lane} — ${r.owner} (${r.ageDays}d)`;
}

/** Print the board; --json/--toml/--emoji swap the payload format. */
export function runLs(repoRoot: string, staleDays: number, opts: LsOptions): LaneRow[] {
  const { storeDir } = resolveExistingStore(repoRoot);
  const rows = projectLanes(storeDir, staleDays).filter((r) =>
    !opts.staleOnly || r.status === "stale"
  );
  if (opts.format !== "human") {
    const payload = renderRecords(rows.map(laneRecord), opts.format, { emoji: laneEmoji });
    if (payload.length > 0) raw(payload);
    return rows;
  }
  raw("# WHO-DOES-WHAT (derived from the store — do not hand-edit; run giwt intercom ls)");
  if (rows.length === 0) {
    raw("  (no lanes)");
    return rows;
  }
  for (const r of rows) {
    const status = r.status.padEnd(STATUS_PAD);
    const stamped = r.staleStamped ? " [stale-stamped]" : "";
    raw(`  ${status}  ${r.lane}  ${r.owner}  ${r.ageDays}d${stamped}`);
  }
  return rows;
}

export interface ReadOptions {
  /** Store-relative file to dump raw (e.g. LANE-x.md, events.jsonl). */
  file?: string;
  /** Event tail length (no file argument). */
  last: number;
  json: boolean;
}

function renderEvent(e: IntercomEvent): string {
  const body = e.body.length > 0 ? ` :: ${e.body}` : "";
  return `${e.ts} #${e.seq} ${e.type.padEnd(5)} ${e.lane || "-"} ${e.actor}${body}`;
}

/** Dump the event tail (newest last) or one store file. Malformed stream
 *  lines are skipped by the backend; their count is surfaced here. */
export function runRead(
  repoRoot: string,
  backendName: "jsonl" | "pijul",
  opts: ReadOptions,
): void {
  const { storeDir } = resolveExistingStore(repoRoot);
  if (opts.file !== undefined) {
    dumpStoreFile(storeDir, opts.file);
    return;
  }
  const { events, malformed } = backendFor(backendName).readEvents(storeDir);
  const tail = events.slice(-Math.max(1, opts.last));
  if (opts.json) {
    raw(JSON.stringify({ events: tail, malformed }));
    return;
  }
  if (tail.length === 0) {
    raw("  (no events)");
  } else {
    for (const e of tail) raw(renderEvent(e));
  }
  if (malformed > 0) raw(`  (skipped ${malformed} malformed line(s))`);
}

/** Dump one store file byte-stable; refuses anything resolving outside the
 *  store (the filename comes from the CLI, but agents copy-paste paths). */
function dumpStoreFile(storeDir: string, rel: string): void {
  const abs = resolve(storeDir, rel);
  if (abs !== storeDir && !abs.startsWith(storeDir + sep)) {
    throw new Error(`intercom: '${rel}' resolves outside the store — refusing`);
  }
  try {
    statSync(abs);
  } catch {
    throw new Error(`intercom: no such file in the store: ${rel}`);
  }
  raw(readFileSync(abs, "utf8"));
}
