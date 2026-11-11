// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Retention: plan computation (archive candidates, stale stamps, event
 * compaction, orphan stores), apply semantics, and the gc summary event.
 * Dry-run default is enforced at the command layer; here we test both
 * halves of the seam.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { backendJsonl } from "./backend-jsonl";
import { applyGc, planGc } from "./gc";
import { projectIdentity } from "./ids";
import { ensureStore, EVENTS_FILE, intercomStateRoot } from "./store";
import { DEFAULT_RETENTION } from "./types";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let stateDir = "";
let repo = "";
let storeDir = "";
const tempRoots: string[] = [];

beforeEach(() => {
  stateDir = mkdtempSync(join(scratchRoot(), "giwt-intercom-gc-state-"));
  repo = mkdtempSync(join(scratchRoot(), "giwt-intercom-gc-repo-"));
  tempRoots.push(stateDir, repo);
  execFileSync("git", ["init", "-q", repo], { env: isolatedGitEnv() });
  process.env.GIWT_INTERCOM_STATE_DIR = stateDir;
  ({ storeDir } = ensureStore(projectIdentity(repo), "jsonl"));
});

afterEach(() => {
  delete process.env.GIWT_INTERCOM_STATE_DIR;
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeStoreFile(name: string, ageDays: number, body = "x"): void {
  const path = join(storeDir, name);
  writeFileSync(path, body);
  const past = new Date(NOW - ageDays * DAY);
  utimesSync(path, past, past);
}

function writeEvent(body: string): void {
  backendJsonl.appendEvent(storeDir, { actor: "a", type: "note", lane: body, refs: [], body });
}

describe("planGc", () => {
  it("plans archive moves, stale stamps, and event compaction", () => {
    writeStoreFile("FIXED-old.md", 20);
    writeStoreFile("FIXED-new.md", 2);
    writeStoreFile("LANE-closed-old.md", 40, "# LANE\nowner=a\ndate=old\n");
    writeStoreFile("FIXED-closed-old.md", 3); // closes the lane (recent FIXED)
    writeStoreFile("LANE-open-old.md", 40); // no FIXED: open lane is never stamped
    for (let i = 0; i < 5; i++) writeEvent(`e${i}`);
    const plan = planGc(storeDir, intercomStateRoot(), DEFAULT_RETENTION, NOW);
    expect(plan.archived.map((a) => a.name)).toEqual(["FIXED-old.md"]);
    expect(plan.stamped.map((s) => s.name)).toEqual(["LANE-closed-old.md"]);
    expect(plan.eventsBefore).toBe(5);
    expect(plan.eventsAfter).toBe(5); // within the 1000 default
    expect(plan.orphans).toEqual([]);
  });

  it("plans event compaction to the keep budget", () => {
    for (let i = 0; i < 5; i++) writeEvent(`e${i}`);
    const plan = planGc(storeDir, intercomStateRoot(), { ...DEFAULT_RETENTION, eventKeep: 2 }, NOW);
    expect(plan.eventsBefore).toBe(5);
    expect(plan.eventsAfter).toBe(2);
  });

  it("flags path-keyed orphan stores whose repo vanished", () => {
    const ghost = mkdtempSync(join(scratchRoot(), "giwt-intercom-gc-ghost-"));
    tempRoots.push(ghost);
    execFileSync("git", ["init", "-q", ghost], { env: isolatedGitEnv() });
    const identity = projectIdentity(ghost);
    const ghostStore = ensureStore(identity, "jsonl").storeDir;
    rmSync(ghost, { recursive: true, force: true });
    const plan = planGc(storeDir, intercomStateRoot(), DEFAULT_RETENTION, NOW);
    expect(plan.orphans).toHaveLength(1);
    expect(plan.orphans[0]?.name).toBe(identity.dirName);
    expect(ghostStore).toContain(identity.dirName);
  });

  it("does not re-plan files already archived or stamped", () => {
    writeStoreFile("FIXED-old.md", 20);
    writeFileSync(join(storeDir, "archive", "FIXED-old.md"), "already archived");
    writeStoreFile("LANE-closed.md", 40);
    writeStoreFile("FIXED-closed.md", 3); // young FIXED closes the lane
    writeFileSync(
      join(storeDir, "LANE-closed.md"),
      `${readFileSync(join(storeDir, "LANE-closed.md"), "utf8")}<!-- intercom: stale -->\n`,
    );
    const plan = planGc(storeDir, intercomStateRoot(), DEFAULT_RETENTION, NOW);
    expect(plan.archived).toEqual([]);
    expect(plan.stamped).toEqual([]);
  });
});

describe("applyGc", () => {
  it("moves FIXED files, stamps lanes, compacts events, appends a gc event", () => {
    writeStoreFile("FIXED-old.md", 20);
    writeStoreFile("LANE-closed.md", 40);
    writeStoreFile("FIXED-closed.md", 3); // young report closes the aged lane
    for (let i = 0; i < 5; i++) writeEvent(`e${i}`);
    const plan = planGc(storeDir, intercomStateRoot(), { ...DEFAULT_RETENTION, eventKeep: 2 }, NOW);
    applyGc(storeDir, intercomStateRoot(), "jsonl", { ...DEFAULT_RETENTION, eventKeep: 2 }, plan);
    expect(existsSync(join(storeDir, "archive", "FIXED-old.md"))).toBe(true);
    expect(existsSync(join(storeDir, "FIXED-old.md"))).toBe(false);
    expect(readFileSync(join(storeDir, "LANE-closed.md"), "utf8")).toContain("intercom: stale");
    const read = backendJsonl.readEvents(storeDir);
    // compaction to 2 + the gc summary event
    expect(read.events.map((e) => e.type)).toEqual(["note", "note", "gc"]);
    expect(read.events.at(-1)?.body).toContain("archived 1, stamped 1");
    expect(readdirSync(storeDir).some((n) => n.includes(".compact."))).toBe(false);
  });

  it("sweeps orphan stores under <stateRoot>/archive/", () => {
    const ghost = mkdtempSync(join(scratchRoot(), "giwt-intercom-gc-ghost2-"));
    tempRoots.push(ghost);
    execFileSync("git", ["init", "-q", ghost], { env: isolatedGitEnv() });
    const identity = projectIdentity(ghost);
    ensureStore(identity, "jsonl");
    rmSync(ghost, { recursive: true, force: true });
    const plan = planGc(storeDir, intercomStateRoot(), DEFAULT_RETENTION, NOW);
    applyGc(storeDir, intercomStateRoot(), "jsonl", DEFAULT_RETENTION, plan);
    expect(existsSync(join(intercomStateRoot(), "archive", identity.dirName))).toBe(true);
    expect(existsSync(join(intercomStateRoot(), identity.dirName))).toBe(false);
  });
});

describe("EVENTS_FILE layout", () => {
  it("keeps the stream at the store root", () => {
    writeEvent("layout");
    expect(existsSync(join(storeDir, EVENTS_FILE))).toBe(true);
  });
});
