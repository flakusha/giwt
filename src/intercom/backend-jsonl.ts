// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * jsonl event backend — the default production engine.
 *
 * Append: one `writeSync` of the whole line on an O_APPEND fd — on Linux
 * the kernel holds the inode lock across the write, so concurrent writers
 * cannot interleave (DESIGN §3). No lock needed, mirroring the ledger's
 * line shape without the lock. seq is stamped as current-line-count + 1
 * (best-effort monotone; concurrent writers may tie — see types.ts).
 * Read: line-parse with torn-tail tolerance — a partially written last
 * line (crash mid-write) and malformed lines are skipped and counted,
 * never thrown (backup state.jsonl precedent).
 * Compaction: read → keep last N → temp+rename (atomic replace), re-reading
 * right before the rename so appends that raced the compaction survive.
 */

import { closeSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { EVENTS_FILE } from "./store";
import {
  type EventRead,
  type IntercomBackendImpl,
  type IntercomEvent,
  type IntercomEventDraft,
} from "./types";

/** Parse one stored event; null on garbage (counted and skipped by readers). */
export function parseEvent(line: string): IntercomEvent | null {
  try {
    const parsed = JSON.parse(line) as IntercomEvent;
    if (
      parsed.v !== 1 || typeof parsed.seq !== "number" || typeof parsed.actor !== "string"
      || typeof parsed.type !== "string" || typeof parsed.lane !== "string"
      || !Array.isArray(parsed.refs) || typeof parsed.body !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function eventsPath(storeDir: string): string {
  return join(storeDir, EVENTS_FILE);
}

function readLines(storeDir: string): string[] {
  try {
    return readFileSync(eventsPath(storeDir), "utf8").split("\n").filter((l) =>
      l.trim().length > 0
    );
  } catch {
    return []; // no stream yet
  }
}

/** Write all lines to a path atomically (temp + rename); empty → empty file. */
function writeAll(path: string, lines: string[]): void {
  const tmp = `${path}.compact.${process.pid}`;
  writeFileSync(tmp, lines.length > 0 ? `${lines.join("\n")}\n` : "");
  renameSync(tmp, path);
}

function stamp(draft: IntercomEventDraft, seq: number): IntercomEvent {
  return {
    ...draft,
    v: 1,
    ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    seq,
  };
}

export const backendJsonl: IntercomBackendImpl = {
  name: "jsonl",

  initStore(_storeDir: string): void {
    // Nothing to scaffold: events.jsonl is created lazily on first append.
  },

  appendEvent(storeDir: string, draft: IntercomEventDraft): IntercomEvent {
    const event = stamp(draft, readLines(storeDir).length + 1);
    const fd = openSync(eventsPath(storeDir), "a");
    try {
      writeSync(fd, `${JSON.stringify(event)}\n`);
    } finally {
      closeSync(fd);
    }
    return event;
  },

  readEvents(storeDir: string): EventRead {
    const events: IntercomEvent[] = [];
    let malformed = 0;
    for (const line of readLines(storeDir)) {
      const event = parseEvent(line);
      if (event === null) malformed++;
      else events.push(event);
    }
    return { events, malformed };
  },

  retireEvents(storeDir: string, keep: number): number {
    const path = eventsPath(storeDir);
    const before = readLines(storeDir);
    const eventsBefore = before.map(parseEvent).filter((e) => e !== null);
    const droppable = Math.max(0, eventsBefore.length - Math.max(0, keep));
    if (droppable === 0) return 0;
    const kept = eventsBefore.slice(droppable);
    // Re-read just before the rename so events appended while we worked are
    // merged into the survivor set, not lost by it. Malformed lines (torn
    // tail, garbage) are dropped by compaction — they would otherwise be
    // promoted to survivors and re-counted forever.
    const now = readLines(storeDir)
      .map(parseEvent)
      .filter((e) => e !== null);
    const latest = now.length > eventsBefore.length
      ? [...kept, ...now.slice(eventsBefore.length)]
      : kept;
    writeAll(path, latest.map((e) => JSON.stringify(e)));
    return droppable;
  },
};

/** Non-blank line count of the event stream (0 when absent). Used by gc
 *  reporting; malformed lines count too — they occupy stream space. */
export function eventLineCount(storeDir: string): number {
  return readLines(storeDir).length;
}
