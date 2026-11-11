// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared types for the durable intercom store (`giwt intercom`).
 *
 * Two layers with different guarantees:
 * - **Claims** — per-lane `LANE-<lane>.md` / `FIXED-<lane>.md` files created
 *   with O_EXCL. The atomic create is the claim: a second claim of the same
 *   lane fails loudly (the race fix from FIELD-STUDY §1.5).
 * - **Events** — one append stream, `events.jsonl` by default (O_APPEND,
 *   one write per event, torn last line tolerated by readers), or a pijul
 *   repo (opt-in dogfood backend, `[intercom] backend = "pijul"`).
 *
 * The event line is a versioned envelope (fixed in v1 so later capabilities
 * need no format migration — intercomm-systems survey):
 *   {"v":1,"ts":"<ISO>","seq":<n>,"actor":"<agent-id>","type":"claim|done|note|gc",
 *    "lane":"<lane>","refs":[...],"body":"..."}
 * `type` stays minimal (claim|done|note|gc); refs/body carry free text
 * today. Readers skip malformed lines and count them (`read` surfaces the
 * count); seq is a best-effort monotone counter stamped at append time
 * (line-count based — concurrent writers may tie, readers never depend on
 * uniqueness).
 *
 * `WHO-DOES-WHAT.md` is never a shared hand-edited file — it is the derived
 * projection `giwt intercom ls` prints (see projection.ts).
 */

/** Event kinds. Deliberately minimal in v1; new capabilities extend this
 *  enum only after the envelope already carries their payload via
 *  refs/body. */
export type IntercomEventType = "claim" | "done" | "note" | "gc";

/** One coordination event in the append stream (the v1 envelope). */
export interface IntercomEvent {
  /** Envelope schema version. */
  v: 1;
  /** ISO-8601 UTC timestamp (stamped by the backend at append). */
  ts: string;
  /** Best-effort monotone counter (stamped by the backend at append). */
  seq: number;
  /** Agent identity: --owner, else GIWT_AGENT ?? `host:pid` (ledger
   *  convention, src/utils/ledger-write.ts). */
  actor: string;
  type: IntercomEventType;
  /** Lane name (sanitized; "" for store-wide events like gc). */
  lane: string;
  /** Structured references (empty in v1 flows; field exists for later
   *  capability adoption without a format migration). */
  refs: string[];
  /** Free text (scope/note/gc summary). Always present, "" when empty. */
  body: string;
}

/** What a caller supplies; the backend stamps v/ts/seq at append time. */
export type IntercomEventDraft = Omit<IntercomEvent, "v" | "ts" | "seq">;

/** A read of the event stream: parsed events plus the malformed-line count
 *  (torn tail, corrupt lines) that readers skipped. */
export interface EventRead {
  events: IntercomEvent[];
  malformed: number;
}

/** Storage engine seam. jsonl is the production backend; pijul is an
 *  opt-in dogfood backend (backend-pijul.ts). */
export interface IntercomBackendImpl {
  readonly name: "jsonl" | "pijul";
  /** Prepare a freshly created store dir (e.g. pijul init). Throws with a
   *  remedy message on an unusable environment. */
  initStore(storeDir: string): void;
  /** Append one event durably, stamping v/ts/seq. Throws on failure
   *  (mutating commands surface append errors, not swallow them). */
  appendEvent(storeDir: string, draft: IntercomEventDraft): IntercomEvent;
  /** Read all events, oldest first. Torn/malformed lines are skipped and
   *  counted, never thrown. */
  readEvents(storeDir: string): EventRead;
  /** Retire all but the newest `keep` events. Returns the number of
   *  events removed. */
  retireEvents(storeDir: string, keep: number): number;
}

/** Retention inputs for gc (settings-derived; see [intercom] schema). */
export interface IntercomRetention {
  /** FIXED-* files older than this move to archive/. */
  fixedArchiveDays: number;
  /** Closed LANE-* files older than this are stamped stale. */
  laneStaleDays: number;
  /** Event stream compaction: keep the newest N events. */
  eventKeep: number;
}

export const DEFAULT_RETENTION: IntercomRetention = {
  fixedArchiveDays: 14,
  laneStaleDays: 30,
  eventKeep: 1000,
};

/** Marker line gc stamps into a closed-but-aged LANE file (idempotent). */
export const STALE_MARK = "intercom: stale";

/** Claim-file prefix and completion-report prefix (the field dialect). */
export const LANE_PREFIX = "LANE-";
export const FIXED_PREFIX = "FIXED-";
