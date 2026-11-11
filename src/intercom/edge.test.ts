// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Edge-branch tests for the intercom modules: vanished stores, unreadable
 * claim files, non-EEXIST claim collisions, non-repo identity probes, and
 * the jsonl no-op scaffold. Complements the per-module suites.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { backendJsonl } from "./backend-jsonl";
import { claimLane, writeFixed } from "./claims";
import { applyGc, planGc } from "./gc";
import { gitCommonDirAbs } from "./ids";
import { projectLanes } from "./projection";
import { DEFAULT_RETENTION, type IntercomRetention } from "./types";

let root = "";
const oldRoots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(scratchRoot(), "giwt-intercom-edge-"));
  oldRoots.push(root);
});

afterEach(() => {
  for (const dir of oldRoots.splice(0)) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

const RETENTION: IntercomRetention = DEFAULT_RETENTION;
const NOW = Date.parse("2026-11-11T12:00:00Z");

describe("planGc edge branches", () => {
  it("vanished store and state root produce an empty plan", () => {
    const plan = planGc(join(root, "missing-store"), join(root, "missing-root"), RETENTION, NOW);
    expect(plan.archived).toEqual([]);
    expect(plan.stamped).toEqual([]);
    expect(plan.orphans).toEqual([]);
  });

  it("non-project dirs in the state root are skipped, not reported orphan", () => {
    const stateRoot = join(root, "state");
    mkdirSync(join(stateRoot, "foreign-dir"), { recursive: true });
    writeFileSync(join(stateRoot, "foreign-dir", "project.json"), "{not json");
    const plan = planGc(join(root, "store"), stateRoot, RETENTION, NOW);
    expect(plan.orphans).toEqual([]);
  });

  it("unreadable aged LANE file is never stamped blindly", () => {
    const store = join(root, "store");
    mkdirSync(store, { recursive: true });
    const lane = join(store, "LANE-old.md");
    writeFileSync(lane, "owner=edge-agent\n");
    const past = new Date(NOW - 40 * 24 * 60 * 60 * 1000);
    utimesSync(lane, past, past);
    chmodSync(lane, 0o000);
    try {
      const plan = planGc(store, join(root, "state"), RETENTION, NOW);
      expect(plan.stamped.some((s) => s.lane === "old")).toBe(false);
    } finally {
      chmodSync(lane, 0o600);
    }
  });
});

describe("claim edge branches", () => {
  it("claim file replaced by a directory still fails as taken", () => {
    const store = join(root, "store");
    mkdirSync(store, { recursive: true });
    mkdirSync(join(store, "LANE-x.md"));
    expect(() => claimLane(store, "x", "edge-agent")).toThrow(/already claimed/);
  });

  it("completion report colliding with a directory still fails as reported", () => {
    const store = join(root, "store");
    mkdirSync(store, { recursive: true });
    mkdirSync(join(store, "FIXED-y.md"));
    expect(() => writeFixed(store, "y", { owner: "edge-agent", note: "n" })).toThrow(
      /already has a completion report/,
    );
  });

  it("double-claim of an unreadable claim file still fails loudly", () => {
    const store = join(root, "store");
    mkdirSync(store, { recursive: true });
    const lane = join(store, "LANE-lock.md");
    writeFileSync(lane, "owner=other\n");
    chmodSync(lane, 0o000);
    try {
      expect(() => claimLane(store, "lock", "edge-agent")).toThrow(/already claimed/);
    } finally {
      chmodSync(lane, 0o600);
    }
  });
});

describe("projection edge branches", () => {
  it("unreadable claim file projects as unknown, never crashes", () => {
    const store = join(root, "store");
    mkdirSync(store, { recursive: true });
    const lane = join(store, "LANE-dim.md");
    writeFileSync(lane, "owner=edge-agent\n");
    chmodSync(lane, 0o000);
    try {
      const rows = projectLanes(store, 30, NOW);
      expect(rows.map((r) => r.lane)).toContain("dim");
    } finally {
      chmodSync(lane, 0o600);
    }
  });
});

describe("identity + backend scaffolding edges", () => {
  it("gitCommonDirAbs throws on a non-repo directory", () => {
    expect(() => gitCommonDirAbs(root)).toThrow(/not a git repository/);
  });

  it("jsonl initStore is an accepted no-op scaffold", () => {
    expect(() => backendJsonl.initStore(join(root, "anywhere"))).not.toThrow();
  });

  it("claim and completion in a missing store rethrow the raw error", () => {
    const ghost = join(root, "no-such-store");
    expect(() => claimLane(ghost, "x", "edge-agent")).toThrow(/ENOENT|no such file/);
    expect(() => writeFixed(ghost, "x", { owner: "edge-agent", note: "n" })).toThrow(
      /ENOENT|no such file/,
    );
  });

  it("applyGc leaves an orphan whose archive slot is already taken", () => {
    const stateRoot = join(root, "state");
    const store = join(root, "store");
    mkdirSync(store, { recursive: true });
    const gone = join(root, "vanished-repo");
    mkdirSync(join(stateRoot, "gone-proj"), { recursive: true });
    writeFileSync(
      join(stateRoot, "gone-proj", "project.json"),
      JSON.stringify({ kind: "path", repoPath: gone }),
    );
    mkdirSync(join(stateRoot, "archive"), { recursive: true });
    writeFileSync(join(stateRoot, "archive", "gone-proj"), "taken");
    const plan = planGc(store, stateRoot, RETENTION, NOW);
    expect(plan.orphans.map((o) => o.name)).toEqual(["gone-proj"]);
    expect(() => applyGc(store, stateRoot, "jsonl", RETENTION, plan)).not.toThrow();
  });
});
