// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
/**
 * Resource contract: injected recorder/stdout/write seams only — no real
 * pijul binary, no global spies, no filesystem or temp dirs.
 */
import { describe, expect, test } from "bun:test";
import type { RunRecorder } from "../utils/runlog";
import { surfacePullConflicts } from "./pijul";

const CONFLICT_JSON = JSON.stringify({
  conflicts: [
    { kind: "add/add", path: "src/a.ts", line: 12 },
    { kind: "edit/edit", path: "src/b.ts" },
  ],
});

function fake() {
  const events: { step: string; status: string; detail?: string; }[] = [];
  const captures: string[] = [];
  const rec = {
    event: (step: string, status: string, detail?: string) =>
      events.push({ step, status, ...(detail !== undefined ? { detail } : {}) }),
    capturePath: (name: string) => {
      captures.push(name);
      return `run/${name}`;
    },
  } satisfies Pick<RunRecorder, "event" | "capturePath">;
  return { rec, events, captures };
}

describe("surfacePullConflicts", () => {
  test("records a fail event and captures raw json output for pull conflicts", () => {
    const { rec, events, captures } = fake();
    const writes: { path: string; data: string; }[] = [];
    surfacePullConflicts({
      rec,
      out: CONFLICT_JSON,
      write: (path, data) => writes.push({ path, data }),
    });
    expect(events).toEqual([
      {
        step: "pijul:conflicts",
        status: "fail",
        detail: "conflicts=2: src/a.ts (add/add), src/b.ts (edit/edit)",
      },
    ]);
    expect(captures).toEqual(["pijul-conflicts.json"]);
    expect(writes).toEqual([{ path: "run/pijul-conflicts.json", data: CONFLICT_JSON }]);
  });

  test("surfaces raw conflict markers when output is not json", () => {
    const { rec, events, captures } = fake();
    const out = "<<<<<<< theirs\nours\n=======\ntheirs\n>>>>>>> theirs\n";
    const writes: { path: string; data: string; }[] = [];
    surfacePullConflicts({ rec, out, write: (path, data) => writes.push({ path, data }) });
    expect(events).toEqual([
      { step: "pijul:conflicts", status: "fail", detail: "conflict markers in output" },
    ]);
    expect(captures).toEqual(["pijul-conflicts.json"]);
    expect(writes).toEqual([{ path: "run/pijul-conflicts.json", data: out }]);
  });

  test("clean or malformed output records nothing", () => {
    for (const out of [JSON.stringify({ conflicts: [] }), "pijul pull ok", "{broken", ""]) {
      const { rec, events, captures } = fake();
      surfacePullConflicts({
        rec,
        out,
        write: () => {
          throw new Error("unexpected write");
        },
      });
      expect(events, out).toEqual([]);
      expect(captures, out).toEqual([]);
    }
  });

  test("no recorder is a no-op", () => {
    expect(() => surfacePullConflicts({ rec: null, out: CONFLICT_JSON })).not.toThrow();
  });

  test("a failed capture never loses the conflict event", () => {
    const { rec, events, captures } = fake();
    surfacePullConflicts({
      rec,
      out: CONFLICT_JSON,
      write: () => {
        throw new Error("disk full");
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.step).toBe("pijul:conflicts");
    expect(captures).toEqual(["pijul-conflicts.json"]);
  });
});
