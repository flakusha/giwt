// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ledger core — pure schema v2 primitives for the agent ledger.
 *
 * Zero imports, no filesystem, no clock, no process access: everything
 * here is deterministic and safe to unit-test (and later to share with
 * a watcher). Writers still emit v1 on disk (Phase 0); readers surface
 * the normalized v2 view via {@link normalizeRecord}.
 *
 * Normalization contract (v1 → v2 view):
 *   - `state: "observed"` (a v1 line carries no lifecycle)
 *   - `agent: "pid:<pid>"` (the only identity v1 ever had)
 *   - `seq: 0` (no sequence information in v1)
 */

/** On-disk schema version this module understands. */
export const LEDGER_SCHEMA_VERSION = 2;

/** Ledger file name inside the shared tree directory. */
export const LEDGER_FILENAME = ".ledger.jsonl";

/** Max records kept in the ledger file (oldest pruned on append). */
export const LEDGER_MAX_RECORDS = 50;

/** Max chars for one record's msg (chat-like, truncated with …). */
export const LEDGER_MAX_MSG = 280;

/** Lifecycle of a v2 writer record. */
export type LedgerState = "in-progress" | "finished" | "postponed";

/** Lifecycle as seen by readers: v1 lines normalize to "observed". */
export type LedgerReadState = LedgerState | "observed";

/** Optional failure detail attached to a v2 record. */
export interface LedgerError {
  message: string;
  code?: number;
  gates?: string[];
}

/** Legacy on-disk record (what writers still emit in Phase 0). */
export interface LedgerRecordV1 {
  v: 1;
  /** ISO-8601 UTC, seconds precision. */
  ts: string;
  pid: number;
  cmd: string;
  /** Resolved current branch at dispatch; "" when unknown. */
  branch: string;
  msg: string;
}

/** Schema v2 record: adds agent identity, lifecycle, sequencing. */
export interface LedgerRecordV2 {
  v: 2;
  /** ISO-8601 UTC, seconds precision. */
  ts: string;
  pid: number;
  agent: string;
  cmd: string;
  /** Resolved current branch at dispatch; "" when unknown. */
  branch: string;
  msg: string;
  state: LedgerState;
  seq: number;
  error?: LedgerError;
}

/** Any on-disk record version. */
export type LedgerRecordAny = LedgerRecordV1 | LedgerRecordV2;

/** The canonical (normalized) record readers work with. */
export type LedgerRecord = LedgerRecordV2;

/**
 * Reader's normalized view of a record: a valid v2 record as-is, or a
 * v1 line upgraded to v2 shape with state "observed".
 */
export type LedgerRecordView = Omit<LedgerRecordV2, "state"> & {
  state: LedgerReadState;
};

/**
 * Normalize one raw parsed line into the v2 view.
 *
 * @param raw - JSON.parse output for a single ledger line
 * @returns the v2 record (as-is when already valid v2), the normalized
 *   v2 view for a valid v1 line, or null when the line is not a record
 */
export function normalizeRecord(raw: unknown): LedgerRecordView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Partial<LedgerRecordAny>;
  if (typeof rec.msg !== "string" || typeof rec.ts !== "string") return null;
  if (rec.v === 2) {
    return {
      v: 2,
      ts: rec.ts,
      pid: rec.pid as number,
      agent: rec.agent as string,
      cmd: rec.cmd as string,
      branch: rec.branch as string,
      msg: rec.msg,
      state: rec.state as LedgerState,
      seq: rec.seq as number,
      ...(rec.error === undefined ? {} : { error: rec.error }),
    };
  }
  if (rec.v === 1 && typeof rec.pid === "number") {
    return {
      v: 2,
      ts: rec.ts,
      pid: rec.pid,
      agent: `pid:${rec.pid}`,
      cmd: rec.cmd as string,
      branch: rec.branch as string,
      msg: rec.msg,
      state: "observed",
      seq: 0,
    };
  }
  return null;
}

/** Result of an incremental tail parse: complete records + resume point. */
export interface LedgerTail {
  records: LedgerRecordView[];
  /** Byte offset of the first incomplete trailing line (or text length). */
  offset: number;
}

/**
 * Parse the complete `\n`-terminated lines of `text` starting at byte
 * offset `fromOffset`. Unparseable or non-normalizable lines are skipped,
 * never fatal. The returned offset resumes at the first incomplete
 * trailing line; when the text ends with `\n` it is `text.length`.
 *
 * @param text - full current ledger file contents
 * @param fromOffset - byte offset of the first unparsed byte (<0 → 0)
 * @returns complete records and the new resume offset
 */
export function parseLedgerTail(text: string, fromOffset: number): LedgerTail {
  const start = Math.max(0, fromOffset);
  if (start >= text.length) return { records: [], offset: start };
  const records: LedgerRecordView[] = [];
  let lineStart = start;
  for (let i = start; i < text.length; i++) {
    if (text.charCodeAt(i) !== 10 /* \n */) continue;
    const line = text.slice(lineStart, i);
    try {
      const record = normalizeRecord(JSON.parse(line));
      if (record !== null) records.push(record);
    } catch { /* skip unparseable line */ }
    lineStart = i + 1;
  }
  return { records, offset: lineStart };
}

/**
 * One-line chat rendering: `[09-10 06:55] [#1234] [branch] cmd: msg`.
 *
 * @param record - ledger record to render
 * @returns single display line
 */
export function formatRecord(record: LedgerRecordView): string {
  const shortTs = record.ts.slice(5, 16).replace("T", " ");
  const branch = record.branch.length > 0 ? record.branch : "-";
  return `[${shortTs}] [#${record.pid}] [${branch}] ${record.cmd}: ${record.msg}`;
}

/**
 * Build a fresh v2 record. `ts` and `agent` are supplied by the caller
 * because this module is pure (no clock, no process access).
 *
 * @param fields - all v2 fields except the literal `v`
 * @returns the complete v2 record
 */
export function newRecord(fields: Omit<LedgerRecordV2, "v">): LedgerRecordV2 {
  return { v: 2, ...fields };
}
