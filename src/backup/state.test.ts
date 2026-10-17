// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendState,
  type BackupEvent,
  lastSuccessMs,
  lastSuccessRow,
  parseDuration,
  readState,
  stalenessAlert,
  stalenessVerdict,
  STATE_FILENAME,
} from "./state";

const HOUR = 3_600_000;
let dir = "";

afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function fresh(): string {
  dir = mkdtempSync(join(process.cwd(), ".tmp", "giwt-bk-state-"));
  return dir;
}

describe("backup state ledger", () => {
  test("append → read round trip; file lands under treeDir with fsync appends", () => {
    const tree = fresh();
    const now = new Date(2026, 9, 17, 12, 0, 0).toISOString();
    appendState(tree, { ts: now, kind: "dump", remote: "", path: "docs", type: "full", ok: true });
    appendState(tree, {
      ts: now,
      kind: "sync",
      remote: "backup@nas",
      path: "backups",
      ok: true,
      offsiteAt: now,
    });
    expect(existsSync(join(tree, STATE_FILENAME))).toBe(true);
    const events = readState(tree);
    expect(events).toHaveLength(2);
    expect(events[1]!.remote).toBe("backup@nas");
    expect(events[1]!.offsiteAt).toBe(now);
  });

  test("corrupt/partial lines are skipped, good lines survive", () => {
    const tree = fresh();
    appendState(tree, {
      ts: "2026-10-17T00:00:00Z",
      kind: "dump",
      remote: "",
      path: "x",
      ok: true,
    });
    writeFileSync(join(tree, STATE_FILENAME), "{half-written", { flag: "a" });
    appendState(tree, {
      ts: "2026-10-17T01:00:00Z",
      kind: "verify",
      remote: "",
      path: "x",
      ok: true,
    });
    const events = readState(tree);
    expect(events.map((e) => e.kind)).toEqual(["dump", "verify"]);
  });

  test("lastSuccessMs picks the newest success per kind and remote", () => {
    const events: BackupEvent[] = [
      { ts: "2026-10-15T00:00:00Z", kind: "dump", remote: "", path: "x", ok: true },
      { ts: "2026-10-17T00:00:00Z", kind: "dump", remote: "", path: "x", ok: true },
      { ts: "2026-10-16T00:00:00Z", kind: "dump", remote: "", path: "x", ok: false },
      { ts: "2026-10-17T02:00:00Z", kind: "sync", remote: "nas", path: "x", ok: true },
      { ts: "2026-10-17T03:00:00Z", kind: "sync", remote: "other", path: "x", ok: true },
    ];
    expect(new Date(lastSuccessMs(events, "dump") ?? 0).toISOString()).toBe(
      "2026-10-17T00:00:00.000Z",
    );
    expect(new Date(lastSuccessMs(events, "sync", "nas") ?? 0).toISOString()).toBe(
      "2026-10-17T02:00:00.000Z",
    );
    expect(lastSuccessMs(events, "copy")).toBeNull();
    expect(lastSuccessRow(events, "copy", "nas")).toBe("  copy nas: never");
  });

  test("parseDuration accepts s/m/h/d and rejects garbage", () => {
    expect(parseDuration("24h")).toBe(24 * HOUR);
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("7d")).toBe(7 * 24 * HOUR);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("24H")).toBeNull();
    expect(parseDuration("forever")).toBeNull();
    expect(parseDuration("-4h")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });

  test("staleness: fresh inside budget, stale at and across it, never-backed-up is stale", () => {
    const now = 10 * HOUR;
    expect(stalenessVerdict(9.5 * HOUR, now, HOUR).fresh).toBe(true);
    expect(stalenessVerdict(9 * HOUR, now, HOUR).fresh).toBe(false); // exactly the budget = stale
    expect(stalenessVerdict(8 * HOUR, now, HOUR).fresh).toBe(false);
    expect(stalenessVerdict(null, now, HOUR)).toEqual({ fresh: false, ageMs: null });
  });

  test("stalenessAlert messages and strict-relevant wording", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    expect(stalenessAlert([], now, 24 * HOUR)).toBe("no successful dump on record");
    const events: BackupEvent[] = [
      {
        ts: new Date(now - 30 * HOUR).toISOString(),
        kind: "dump",
        remote: "",
        path: "x",
        ok: true,
      },
    ];
    expect(stalenessAlert(events, now, 24 * HOUR)).toContain("30.0h old");
    const freshEvents: BackupEvent[] = [
      { ts: new Date(now - HOUR).toISOString(), kind: "dump", remote: "", path: "x", ok: true },
    ];
    expect(stalenessAlert(freshEvents, now, 24 * HOUR)).toBeNull();
  });

  test("alert events are recorded and never count as successes", () => {
    const tree = fresh();
    appendState(tree, {
      ts: "2026-10-17T12:00:00Z",
      kind: "alert",
      remote: "",
      path: "",
      ok: false,
      note: "last successful dump is 30.0h old",
    });
    const events = readState(tree);
    expect(events[0]!.kind).toBe("alert");
    expect(lastSuccessMs(events, "alert")).toBeNull();
    expect(readFileSync(join(tree, STATE_FILENAME), "utf8").endsWith("\n")).toBe(true);
  });
});
