// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Interconnect freshness gate tests: missing/stale pairs fail, --fix
 * regenerates byte-identical output, broken **Related:** targets stay red
 * after a fix, and [plan] interconnect = false drops the gate from "all"
 * while an explicit --gates interconnect still runs it.
 *
 * Resource contract: every test owns a mkdtemp fixture (parallel-safe),
 * released in finally.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../../utils/scratch-tmp";
import { interconnectOutputs, runInterconnectGate, writeInterconnectFiles } from "../interconnect";
import { runValidate } from "../validate";

function makeFixture(): {
  root: string;
  opts: Parameters<typeof runInterconnectGate>[0];
  ticketsDir: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(scratchRoot(), "giwt-icgate-"));
  const planDir = join(root, ".plan");
  const ticketsDir = join(planDir, "tickets");
  mkdirSync(ticketsDir, { recursive: true });
  const opts = {
    planDir,
    projectRoot: root,
    ticketsDir,
    epicsDir: join(planDir, "epics"),
    codeMapPath: join(planDir, "code-map.json"),
    indexPath: join(ticketsDir, "index.json"),
    fix: false,
  };
  return { root, opts, ticketsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function seedGoodPlan(opts: Parameters<typeof runInterconnectGate>[0]): void {
  writeFileSync(
    join(opts.ticketsDir, "TASK-one.md"),
    "# TASK: one\n\n**Status:** Not Started\n\n**Summary:** owns `src/one.ts`.\n",
  );
  writeFileSync(
    opts.codeMapPath,
    JSON.stringify({ "src/one.ts": [{ kind: "ticket", source: ".plan/tickets/TASK-one.md" }] })
      + "\n",
  );
}

describe("interconnect freshness gate", () => {
  test("missing pair fails; --fix writes it and passes; repeat is byte-identical", () => {
    const fx = makeFixture();
    try {
      seedGoodPlan(fx.opts);
      const missing = runInterconnectGate({ ...fx.opts, fix: false });
      expect(missing.pass).toBe(false);
      expect(missing.findings.some((f) => f.message.includes("missing"))).toBe(true);

      const fixed = runInterconnectGate({ ...fx.opts, fix: true });
      expect(fixed.pass).toBe(true);
      expect(existsSync(join(fx.opts.planDir, "interconnect.json"))).toBe(true);
      expect(existsSync(join(fx.opts.planDir, "interconnect.md"))).toBe(true);
      const jsonOnce = readFileSync(join(fx.opts.planDir, "interconnect.json"), "utf8");

      // Idempotency: a second --write is byte-identical.
      const outputs = interconnectOutputs(fx.opts);
      writeInterconnectFiles(fx.opts.planDir, outputs);
      expect(readFileSync(join(fx.opts.planDir, "interconnect.json"), "utf8")).toBe(jsonOnce);
      expect(fixed.fixMsgs.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("stale artifacts fail with the first-difference line; fix regenerates", () => {
    const fx = makeFixture();
    try {
      seedGoodPlan(fx.opts);
      writeInterconnectFiles(fx.opts.planDir, interconnectOutputs(fx.opts));
      writeFileSync(
        join(fx.opts.ticketsDir, "TASK-two.md"),
        "# TASK: two\n\n**Status:** Not Started\n\n**Summary:** x\n",
      );
      const stale = runInterconnectGate({ ...fx.opts, fix: false });
      expect(stale.pass).toBe(false);
      expect(stale.findings.some((f) => f.message.includes("stale"))).toBe(true);
      const fixed = runInterconnectGate({ ...fx.opts, fix: true });
      expect(fixed.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("broken **Related:** target fails with file/field/path and survives --fix", () => {
    const fx = makeFixture();
    try {
      seedGoodPlan(fx.opts);
      writeFileSync(
        join(fx.opts.ticketsDir, "TASK-broken.md"),
        "# TASK: broken\n\n**Status:** Not Started\n**Related:** TASK-nope.md\n\n**Summary:** x\n",
      );
      const gate = runInterconnectGate({ ...fx.opts, fix: true });
      expect(gate.pass).toBe(false);
      const f = gate.findings.find((x) => x.message.includes("TASK-nope.md"));
      expect(f).toBeDefined();
      expect(f!.level).toBe("error");
      expect(f!.message).toContain("TASK-broken.md: **Related:**");
      // fix wrote the pair but keeps no fix notes → reported unfixable
      expect(gate.fixMsgs).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("runValidate: 'all' honors [plan] interconnect=false; explicit gate still runs", () => {
    const fx = makeFixture();
    try {
      seedGoodPlan(fx.opts);
      const base = {
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.opts.ticketsDir,
        epicsDir: fx.opts.epicsDir,
        backlogDir: join(fx.root, ".plan", "backlog"),
        planDir: fx.opts.planDir,
        srcDir: "src",
        codeMapPath: fx.opts.codeMapPath,
        epicsIndexPath: join(fx.opts.planDir, "epics-index.md"),
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        runSync: () => 0,
      };
      const withAll = runValidate({ ...base, gates: ["all"] });
      expect(withAll.results.some((r) => r.gate === "interconnect")).toBe(true);
      const disabled = runValidate({ ...base, gates: ["all"], interconnectGate: false });
      expect(disabled.results.some((r) => r.gate === "interconnect")).toBe(false);
      const explicit = runValidate({ ...base, gates: ["interconnect"], interconnectGate: false });
      expect(explicit.results.some((r) => r.gate === "interconnect")).toBe(true);
      expect(explicit.pass).toBe(false); // pair missing
    } finally {
      fx.cleanup();
    }
  });
});
