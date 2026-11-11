// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * jsonl event backend: envelope round-trips (seq stamping), torn-tail and
 * malformed-line tolerance with counts, compaction (keep-last-N), and the
 * line counter gc reports.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { backendJsonl, eventLineCount, parseEvent } from "./backend-jsonl";
import { EVENTS_FILE } from "./store";
import type { IntercomEventDraft } from "./types";

let storeDir = "";
const tempRoots: string[] = [];

beforeEach(() => {
  storeDir = mkdtempSync(join(scratchRoot(), "giwt-intercom-jsonl-"));
  tempRoots.push(storeDir);
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function draft(type: IntercomEventDraft["type"] = "note", lane = "x"): IntercomEventDraft {
  return { actor: "agent-a", type, lane, refs: [], body: "hello" };
}

function streamLines(): string[] {
  try {
    return readFileSync(join(storeDir, EVENTS_FILE), "utf8").split("\n").filter((l) =>
      l.length > 0
    );
  } catch {
    return [];
  }
}

describe("jsonl appendEvent", () => {
  it("stamps the v1 envelope (v/ts/seq) and orders reads oldest-first", () => {
    const first = backendJsonl.appendEvent(storeDir, draft("claim", "lane-a"));
    const second = backendJsonl.appendEvent(storeDir, draft("done", "lane-a"));
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.v).toBe(1);
    expect(first.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first).toEqual({
      v: 1,
      ts: first.ts,
      seq: 1,
      actor: "agent-a",
      type: "claim",
      lane: "lane-a",
      refs: [],
      body: "hello",
    });
    const read = backendJsonl.readEvents(storeDir);
    expect(read.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(read.malformed).toBe(0);
  });

  it("creates the stream lazily and reads an absent one as empty", () => {
    expect(backendJsonl.readEvents(storeDir)).toEqual({ events: [], malformed: 0 });
    backendJsonl.appendEvent(storeDir, draft());
    expect(streamLines()).toHaveLength(1);
  });
});

describe("jsonl readEvents tolerance", () => {
  it("skips a torn last line and counts it", () => {
    backendJsonl.appendEvent(storeDir, draft());
    appendFileSync(join(storeDir, EVENTS_FILE), "{\"v\":1,\"ts\":\"2026-11-11T00");
    const read = backendJsonl.readEvents(storeDir);
    expect(read.events).toHaveLength(1);
    expect(read.malformed).toBe(1);
  });

  it("skips garbage lines but keeps neighbors", () => {
    backendJsonl.appendEvent(storeDir, draft("claim", "a"));
    appendFileSync(join(storeDir, EVENTS_FILE), `${JSON.stringify({ nope: true })}\n`);
    backendJsonl.appendEvent(storeDir, draft("done", "a"));
    const read = backendJsonl.readEvents(storeDir);
    expect(read.events.map((e) => e.type)).toEqual(["claim", "done"]);
    expect(read.malformed).toBe(1);
  });

  it("parseEvent rejects wrong-typed envelope fields", () => {
    expect(parseEvent("not json")).toBe(null);
    expect(
      parseEvent(
        JSON.stringify({ v: 2, seq: 1, actor: "a", type: "claim", lane: "x", refs: [], body: "" }),
      ),
    ).toBe(null);
    expect(
      parseEvent(
        JSON.stringify({
          v: 1,
          seq: "x",
          actor: "a",
          type: "claim",
          lane: "x",
          refs: [],
          body: "",
        }),
      ),
    ).toBe(null);
    expect(
      parseEvent(JSON.stringify({ v: 1, seq: 1, actor: "a", type: "claim", lane: "x", body: "" })),
    ).toBe(null);
  });
});

describe("jsonl retireEvents", () => {
  it("keeps the newest N events and drops the rest", () => {
    for (let i = 0; i < 5; i++) backendJsonl.appendEvent(storeDir, draft("note", `lane-${i}`));
    expect(backendJsonl.retireEvents(storeDir, 3)).toBe(2);
    const read = backendJsonl.readEvents(storeDir);
    expect(read.events.map((e) => e.lane)).toEqual(["lane-2", "lane-3", "lane-4"]);
  });

  it("keeps the stream appendable after compaction", () => {
    for (let i = 0; i < 4; i++) backendJsonl.appendEvent(storeDir, draft("note", `lane-${i}`));
    backendJsonl.retireEvents(storeDir, 2);
    backendJsonl.appendEvent(storeDir, draft("gc", ""));
    const read = backendJsonl.readEvents(storeDir);
    expect(read.events.map((e) => e.type)).toEqual(["note", "note", "gc"]);
    expect(read.events[0]?.seq).toBe(3);
  });

  it("no-ops when the stream is within budget", () => {
    backendJsonl.appendEvent(storeDir, draft());
    expect(backendJsonl.retireEvents(storeDir, 1000)).toBe(0);
    expect(backendJsonl.readEvents(storeDir).events).toHaveLength(1);
  });

  it("drops a torn tail rather than compacting around it", () => {
    for (let i = 0; i < 3; i++) backendJsonl.appendEvent(storeDir, draft());
    appendFileSync(join(storeDir, EVENTS_FILE), "torn-no-newline");
    expect(backendJsonl.retireEvents(storeDir, 1)).toBe(2);
    const read = backendJsonl.readEvents(storeDir);
    expect(read.events).toHaveLength(1);
    expect(read.malformed).toBe(0);
    expect(streamLines()).toHaveLength(1);
  });
});

describe("eventLineCount", () => {
  it("counts non-blank lines including malformed ones", () => {
    backendJsonl.appendEvent(storeDir, draft());
    appendFileSync(join(storeDir, EVENTS_FILE), "garbage\n");
    expect(eventLineCount(storeDir)).toBe(2);
    expect(eventLineCount(join(storeDir, "absent"))).toBe(0);
  });
});
