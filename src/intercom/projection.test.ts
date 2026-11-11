// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * The WHO-DOES-WHAT projection: ACTIVE/DONE/STALE classification, orphan
 * FIXED reports, header-based aging (stale stamps must not reset their own
 * verdict), and the stale-stamp flag.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { projectLanes } from "./projection";

let storeDir = "";
const tempRoots: string[] = [];
const NOW = Date.parse("2026-11-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  storeDir = mkdtempSync(join(scratchRoot(), "giwt-intercom-proj-"));
  tempRoots.push(storeDir);
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function lane(name: string, owner: string, dateIso: string): void {
  writeFileSync(
    join(storeDir, `LANE-${name}.md`),
    `# LANE: ${name}\nowner=${owner}\ndate=${dateIso}\n`,
  );
}

function fixed(name: string, owner: string, dateIso: string): void {
  writeFileSync(
    join(storeDir, `FIXED-${name}.md`),
    `# FIXED: ${name}\nowner=${owner}\ndate=${dateIso}\n`,
  );
}

describe("projectLanes", () => {
  it("classifies active/done lanes and reads owners", () => {
    lane("active-lane", "agent-1", "2026-11-10T00:00:00Z");
    lane("done-lane", "agent-2", "2026-11-01T00:00:00Z");
    fixed("done-lane", "agent-2", "2026-11-09T00:00:00Z");
    const rows = projectLanes(storeDir, 30, NOW);
    // Age is the CLAIM's age even for done lanes (staleness clock); the
    // done status wins over stale for closed lanes.
    expect(rows).toEqual([
      { lane: "active-lane", status: "active", owner: "agent-1", ageDays: 1, staleStamped: false },
      { lane: "done-lane", status: "done", owner: "agent-2", ageDays: 10, staleStamped: false },
    ]);
  });

  it("marks long-active lanes stale at the threshold", () => {
    lane("old-lane", "agent-1", "2026-10-01T00:00:00Z");
    const rows = projectLanes(storeDir, 30, NOW);
    expect(rows[0]?.status).toBe("stale");
    expect(rows[0]?.ageDays).toBe(41);
  });

  it("reports orphan FIXED reports (no claim file) with FIXED owner/age", () => {
    fixed("implicit", "agent-9", "2026-11-08T00:00:00Z");
    const rows = projectLanes(storeDir, 30, NOW);
    expect(rows).toEqual([
      { lane: "implicit", status: "done", owner: "agent-9", ageDays: 3, staleStamped: false },
    ]);
  });

  it("ages from the date header, so stale stamps do not reset the clock", () => {
    lane("stamped-lane", "agent-1", "2026-09-01T00:00:00Z");
    // gc-style stamp rewrites the file; mtime is now, header date is not.
    const path = join(storeDir, "LANE-stamped-lane.md");
    writeFileSync(path, `${readOf(path)}<!-- intercom: stale 2026-11-11 -->\n`);
    utimesSync(path, new Date(NOW), new Date(NOW));
    const rows = projectLanes(storeDir, 30, NOW);
    expect(rows[0]?.status).toBe("stale");
    expect(rows[0]?.staleStamped).toBe(true);
    expect(rows[0]?.ageDays).toBe(71);
  });

  it("falls back to mtime when no date header exists", () => {
    const path = join(storeDir, "LANE-no-date.md");
    writeFileSync(path, "# LANE: no-date\nowner=a\n");
    utimesSync(path, new Date(NOW - 40 * DAY), new Date(NOW - 40 * DAY));
    const rows = projectLanes(storeDir, 30, NOW);
    expect(rows[0]?.status).toBe("stale");
  });

  it("returns [] for a missing store dir", () => {
    expect(projectLanes(join(storeDir, "absent"), 30, NOW)).toEqual([]);
  });
});

import { readFileSync } from "node:fs";

function readOf(path: string): string {
  return readFileSync(path, "utf8");
}
