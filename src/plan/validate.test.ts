// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/plan/validate.ts — comprehensive .plan/ validator.
 *
 * Resource contract (parallel-safe): every test owns a mkdtemp fixture.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_GATES,
  FIXABLE_GATES,
  type GateName,
  MAX_LISTED_FINDINGS,
  renderUnfixableGates,
  renderValidateSummary,
  resolveFromRoot,
  runValidate,
} from "./validate";

interface Fixture {
  root: string;
  planDir: string;
  ticketsDir: string;
  epicsDir: string;
  backlogDir: string;
  codeMapPath: string;
  epicsIndexPath: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-validate-"));
  const planDir = join(root, ".plan");
  const ticketsDir = join(planDir, "tickets");
  const epicsDir = join(planDir, "epics");
  const backlogDir = join(planDir, "backlog");
  mkdirSync(ticketsDir, { recursive: true });
  mkdirSync(epicsDir, { recursive: true });
  mkdirSync(backlogDir, { recursive: true });
  return {
    root,
    planDir,
    ticketsDir,
    epicsDir,
    backlogDir,
    codeMapPath: join(planDir, "code-map.json"),
    epicsIndexPath: join(planDir, "epics-index.md"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeTicket(
  fx: Fixture,
  name: string,
  sections: string[] = [
    "Status",
    "Priority",
    "Effort",
    "Summary",
    "Context",
    "Acceptance Criteria",
  ],
): void {
  const content = `# ${name}\n\n${sections.map((s) => `**${s}:** value`).join("\n")}\n`;
  writeFileSync(join(fx.ticketsDir, name), content);
}

function writeEpic(
  fx: Fixture,
  name: string,
  sections: string[] = ["Status", "Priority", "Effort", "Type", "Tags", "Overview"],
): void {
  const content = `# EPIC: ${name}\n\n${
    sections.map((s) => `**${s}:** value`).join("\n")
  }\n\n## Overview\n\nText.\n`;
  writeFileSync(join(fx.epicsDir, name), content);
}

// ── ALL_GATES ───────────────────────────────────────────────────

describe("ALL_GATES", () => {
  test("contains all expected gates", () => {
    expect(ALL_GATES).toContain("format");
    expect(ALL_GATES).toContain("linkage");
    expect(ALL_GATES).toContain("backlog");
    expect(ALL_GATES).toContain("tickets");
    expect(ALL_GATES).toContain("code-map");
    expect(ALL_GATES).toContain("links");
    expect(ALL_GATES).toContain("spdx");
    expect(ALL_GATES).toContain("naming");
    expect(ALL_GATES).toContain("epics-doc");
    expect(ALL_GATES).toHaveLength(9);
  });
});

describe("validate / unknown gates", () => {
  test("rejects unknown gate name instead of passing vacuously", () => {
    const fx = makeFixture();
    try {
      expect(() =>
        runValidate({
          projectRoot: fx.root,
          worktreeRoot: fx.root,
          ticketsDir: fx.ticketsDir,
          epicsDir: fx.epicsDir,
          backlogDir: fx.backlogDir,
          planDir: fx.planDir,
          srcDir: "src",
          codeMapPath: fx.codeMapPath,
          epicsIndexPath: fx.epicsIndexPath,
          mapSources: [],
          linkScanDirs: [],
          backlogIndexFiles: [],
          gates: ["format", "nope"] as GateName[],
          runSync: () => 0,
        })
      ).toThrow(/unknown gate/);
    } finally {
      fx.cleanup();
    }
  });
});

// ── format gate ─────────────────────────────────────────────────

describe("validate / format gate", () => {
  test("passes when all ticket sections present", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-well-formed.md");
      writeEpic(fx, "epic-good.md");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format"],
        runSync: () => 0,
      });
      const formatResult = result.results.find((r) => r.gate === "format");
      expect(formatResult).toBeDefined();
      expect(formatResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("fails when ticket missing required section", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-bad.md", ["Status", "Priority"]); // missing Effort, Summary, Context, AC
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format"],
        runSync: () => 0,
      });
      const formatResult = result.results.find((r) => r.gate === "format");
      expect(formatResult!.pass).toBe(false);
      expect(formatResult!.findings.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("warns when tickets dir missing", () => {
    const fx = makeFixture();
    try {
      // Don't write any tickets
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: join(fx.root, "nonexistent"),
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format"],
        runSync: () => 0,
      });
      const formatResult = result.results.find((r) => r.gate === "format");
      expect(formatResult!.findings.some((f) => f.level === "warn")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ── linkage gate ────────────────────────────────────────────────

describe("validate / linkage gate", () => {
  test("passes when no linkage to check", () => {
    const fx = makeFixture();
    try {
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["linkage"],
        runSync: () => 0,
      });
      const linkageResult = result.results.find((r) => r.gate === "linkage");
      expect(linkageResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("reports broken epic ref in ticket", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-bad-ref.md");
      // Override the ticket with an epic ref
      writeFileSync(
        join(fx.ticketsDir, "TASK-bad-ref.md"),
        "# TASK-bad-ref\n\n**Status:** open\n**Priority:** high\n**Effort:** Medium\n**Summary:** test\n**Context:** test\n**Acceptance Criteria:** test\n\n**Epic:** epic-nonexistent.md\n",
      );
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["linkage"],
        runSync: () => 0,
      });
      const linkageResult = result.results.find((r) => r.gate === "linkage");
      expect(linkageResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("warns (non-gating) when tickets are not bound to an epic", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-unbound.md");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["linkage"],
        runSync: () => 0,
      });
      const linkageResult = result.results.find((r) => r.gate === "linkage");
      // The aggregated warn finding is present, but the gate still passes:
      // linkage fails on error-level findings only.
      expect(linkageResult!.pass).toBe(true);
      const warn = linkageResult!.findings.find(
        (f) => f.level === "warn" && f.message.includes("not bound to an epic"),
      );
      expect(warn).toBeDefined();
      expect(warn!.message).toContain("1 ticket(s) not bound to an epic");
      expect(warn!.message).toContain("TASK-unbound.md");
    } finally {
      fx.cleanup();
    }
  });
});

// ── backlog gate ────────────────────────────────────────────────

describe("validate / backlog gate", () => {
  test("warns when backlog dir missing", () => {
    const fx = makeFixture();
    try {
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: join(fx.root, "nonexistent"),
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["backlog"],
        runSync: () => 0,
      });
      const backlogResult = result.results.find((r) => r.gate === "backlog");
      expect(backlogResult!.findings.some((f) => f.level === "warn")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("passes when backlog in sync", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.backlogDir, "priority.md"),
        `## File map\n\n| [tier](./tier.md) | desc |\n`,
      );
      writeFileSync(join(fx.backlogDir, "tier.md"), "# Tier\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: ["priority.md"],
        gates: ["backlog"],
        runSync: () => 0,
      });
      const backlogResult = result.results.find((r) => r.gate === "backlog");
      expect(backlogResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("reports orphans, phantoms, and outside targets", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.backlogDir, "priority.md"),
        `## File map\n\n| [ghost](./ghost.md) | desc |\n| [outside](../outside.md) | d |\n`,
      );
      writeFileSync(join(fx.backlogDir, "orphan.md"), "# Orphan\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: ["priority.md"],
        gates: ["backlog"],
        runSync: () => 0,
      });
      const backlogResult = result.results.find((r) => r.gate === "backlog");
      expect(backlogResult!.pass).toBe(false);
      expect(backlogResult!.findings.some((f) => f.message.includes("orphan"))).toBe(true);
      expect(backlogResult!.findings.some((f) => f.message.includes("phantom"))).toBe(true);
      expect(backlogResult!.findings.some((f) => f.message.includes("outside"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ── tickets gate ────────────────────────────────────────────────

describe("validate / tickets gate", () => {
  test("passes when runSync returns 0", () => {
    const fx = makeFixture();
    try {
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["tickets"],
        runSync: () => 0,
      });
      const ticketsResult = result.results.find((r) => r.gate === "tickets");
      expect(ticketsResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("fails when runSync returns non-zero", () => {
    const fx = makeFixture();
    try {
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["tickets"],
        runSync: () => 1,
      });
      const ticketsResult = result.results.find((r) => r.gate === "tickets");
      expect(ticketsResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

// ── spdx gate ──────────────────────────────────────────────────

describe("validate / spdx gate", () => {
  test("passes when all .plan/ files have SPDX", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.ticketsDir, "TASK-good.md"),
        "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n# Good\n",
      );
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["spdx"],
        runSync: () => 0,
      });
      const spdxResult = result.results.find((r) => r.gate === "spdx");
      expect(spdxResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("fails when .plan/ file missing SPDX", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.ticketsDir, "TASK-bad.md"), "# Bad\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["spdx"],
        runSync: () => 0,
      });
      const spdxResult = result.results.find((r) => r.gate === "spdx");
      expect(spdxResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

// ── naming gate ────────────────────────────────────────────────

describe("validate / naming gate", () => {
  test("passes with valid TYPE-kebab-case.md", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "BUG-foo-bar.md");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["naming"],
        runSync: () => 0,
      });
      const namingResult = result.results.find((r) => r.gate === "naming");
      expect(namingResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("fails with invalid filename", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "lowercase-name.md");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["naming"],
        runSync: () => 0,
      });
      const namingResult = result.results.find((r) => r.gate === "naming");
      expect(namingResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

// ── code-map gate ───────────────────────────────────────────────

describe("validate / code-map gate", () => {
  test("fails when code-map.json missing", () => {
    const fx = makeFixture();
    try {
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["code-map"],
        runSync: () => 0,
      });
      const cmResult = result.results.find((r) => r.gate === "code-map");
      expect(cmResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("fails when code-map.json is stale", () => {
    const fx = makeFixture();
    try {
      writeFileSync(fx.codeMapPath, JSON.stringify({ "src/stale.ts": [] }, null, 2));
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["code-map"],
        runSync: () => 0,
      });
      const cmResult = result.results.find((r) => r.gate === "code-map");
      expect(cmResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("passes when code-map.json matches fresh", () => {
    const fx = makeFixture();
    try {
      // Build and write the map, then validate
      const { buildMap, writeMap } = require("./code-map");
      const map = buildMap(fx.root, []);
      writeMap(fx.codeMapPath, map);
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["code-map"],
        runSync: () => 0,
      });
      const cmResult = result.results.find((r) => r.gate === "code-map");
      expect(cmResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ── links gate ──────────────────────────────────────────────────

describe("validate / links gate", () => {
  test("fails when broken links found", () => {
    const fx = makeFixture();
    try {
      mkdirSync(join(fx.root, "docs"), { recursive: true });
      writeFileSync(join(fx.root, "docs/index.md"), "[broken](docs/missing.md)\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: ["docs"],
        backlogIndexFiles: [],
        gates: ["links"],
        runSync: () => 0,
      });
      const linksResult = result.results.find((r) => r.gate === "links");
      expect(linksResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("reports orphan TASK refs and broken comments", () => {
    const fx = makeFixture();
    try {
      mkdirSync(join(fx.root, "src"), { recursive: true });
      writeFileSync(
        join(fx.root, "src/a.ts"),
        "// see docs/spec/missing.md\nexport const x = 1;",
      );
      mkdirSync(join(fx.root, ".plan/epics"), { recursive: true });
      writeFileSync(
        join(fx.root, ".plan/epics/epic.md"),
        "# EPIC: Test\n\nTASK-nonexistent is here\n",
      );
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [".plan"],
        backlogIndexFiles: [],
        gates: ["links"],
        runSync: () => 0,
      });
      const linksResult = result.results.find((r) => r.gate === "links");
      expect(linksResult!.pass).toBe(false);
      expect(linksResult!.findings.some((f) => f.message.includes("orphan TASK"))).toBe(true);
      expect(linksResult!.findings.some((f) => f.message.includes("comment citation"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("passes when no broken links", () => {
    const fx = makeFixture();
    try {
      mkdirSync(join(fx.root, "docs"), { recursive: true });
      writeFileSync(join(fx.root, "docs/target.md"), "# Target");
      writeFileSync(join(fx.root, "docs/index.md"), "[link](docs/target.md)\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: ["docs"],
        backlogIndexFiles: [],
        gates: ["links"],
        runSync: () => 0,
      });
      const linksResult = result.results.find((r) => r.gate === "links");
      expect(linksResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ── epics-doc gate ──────────────────────────────────────────────

describe("validate / epics-doc gate", () => {
  test("fails when epics-index.md missing", () => {
    const fx = makeFixture();
    try {
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["epics-doc"],
        runSync: () => 0,
      });
      const edResult = result.results.find((r) => r.gate === "epics-doc");
      expect(edResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("fails when epics-index.md is stale", () => {
    const fx = makeFixture();
    try {
      writeEpic(fx, "epic-auth.md");
      writeFileSync(fx.epicsIndexPath, "# Stale content\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["epics-doc"],
        runSync: () => 0,
      });
      const edResult = result.results.find((r) => r.gate === "epics-doc");
      expect(edResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("passes when epics-index.md is fresh", () => {
    const fx = makeFixture();
    try {
      writeEpic(fx, "epic-auth.md");
      // Generate the index first
      const { genDocs } = require("./gen-docs");
      genDocs(fx.epicsDir, fx.epicsIndexPath, join(fx.backlogDir, "open.md"));
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["epics-doc"],
        runSync: () => 0,
      });
      const edResult = result.results.find((r) => r.gate === "epics-doc");
      expect(edResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ── linkage gate: epic → ticket path ───────────────────────────

describe("validate / linkage gate: epic → ticket", () => {
  test("reports broken Linked Tasks file reference", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.epicsDir, "epic-broken.md"),
        "# EPIC: Broken\n\n**Status:** 📋 Planned\n**Priority:** Low\n**Effort:** Small\n**Type:** Feature\n**Tags:**\n\n## Overview\n\nText.\n\n## Linked Tasks\n\n- [ ] [TASK-missing](./TASK-missing.md)\n",
      );
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["linkage"],
        runSync: () => 0,
      });
      const linkageResult = result.results.find((r) => r.gate === "linkage");
      expect(linkageResult!.pass).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("passes when Linked Tasks reference exists", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-real.md");
      writeFileSync(
        join(fx.epicsDir, "epic-good.md"),
        "# EPIC: Good\n\n**Status:** 📋 Planned\n**Priority:** Low\n**Effort:** Small\n**Type:** Feature\n**Tags:**\n\n## Overview\n\nText.\n\n## Linked Tasks\n\n- [ ] [TASK-real](./TASK-real.md)\n",
      );
      // The link resolves against epicsDir + target, not ticketsDir
      // So we need the file in epicsDir too, or use relative path to tickets/
      // Actually, resolveTarget checks join(epicsDir, target) which would be epicsDir/TASK-real.md
      // Let's create it there
      writeFileSync(join(fx.epicsDir, "TASK-real.md"), "# Real\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["linkage"],
        runSync: () => 0,
      });
      const linkageResult = result.results.find((r) => r.gate === "linkage");
      expect(linkageResult!.pass).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ── all gates ───────────────────────────────────────────────────

describe("validate / all gates", () => {
  test("runs all gates when 'all' specified", () => {
    const fx = makeFixture();
    try {
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["all"],
        runSync: () => 0,
      });
      expect(result.results).toHaveLength(ALL_GATES.length);
    } finally {
      fx.cleanup();
    }
  });

  test("aggregates issue count correctly", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "bad-name.md"); // fails naming
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["naming"],
        runSync: () => 0,
      });
      expect(result.pass).toBe(false);
      expect(result.issueCount).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });
});

// ── --fix mode ──────────────────────────────────────────────────

describe("validate / --fix mode", () => {
  test("FIXABLE_GATES contains fixable gates", () => {
    expect(FIXABLE_GATES).toContain("backlog");
    expect(FIXABLE_GATES).toContain("tickets");
    expect(FIXABLE_GATES).toContain("code-map");
    expect(FIXABLE_GATES).toContain("epics-doc");
    expect(FIXABLE_GATES).not.toContain("format");
    expect(FIXABLE_GATES).not.toContain("linkage");
    expect(FIXABLE_GATES).not.toContain("links");
    expect(FIXABLE_GATES).not.toContain("spdx");
    expect(FIXABLE_GATES).not.toContain("naming");
  });

  test("fixes backlog orphans when fix=true", () => {
    const fx = makeFixture();
    try {
      // priority.md has no file map entry for orphan.md
      writeFileSync(
        join(fx.backlogDir, "priority.md"),
        "## File map\n\n| [tier](./tier.md) | desc |\n",
      );
      writeFileSync(join(fx.backlogDir, "tier.md"), "# Tier\n");
      writeFileSync(join(fx.backlogDir, "orphan.md"), "# Orphan\n");

      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: ["priority.md"],
        gates: ["backlog"],
        runSync: () => 0,
        fix: true,
      });

      const backlogResult = result.results.find((r) => r.gate === "backlog");
      expect(backlogResult!.fixes).toBeDefined();
      expect(backlogResult!.fixes!.length).toBeGreaterThan(0);
      expect(backlogResult!.pass).toBe(true); // re-checked after fix
      expect(result.fixedCount).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("regenerates stale code-map.json when fix=true", () => {
    const fx = makeFixture();
    try {
      // Write a stale map
      writeFileSync(fx.codeMapPath, JSON.stringify({ "src/stale.ts": [] }, null, 2));

      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["code-map"],
        runSync: () => 0,
        fix: true,
      });

      const cmResult = result.results.find((r) => r.gate === "code-map");
      expect(cmResult!.fixes).toBeDefined();
      expect(cmResult!.pass).toBe(true); // re-checked after fix
    } finally {
      fx.cleanup();
    }
  });

  test("regenerates stale epics-index.md when fix=true", () => {
    const fx = makeFixture();
    try {
      writeEpic(fx, "epic-auth.md");
      writeFileSync(fx.epicsIndexPath, "# Stale content\n");

      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["epics-doc"],
        runSync: () => 0,
        fix: true,
      });

      const edResult = result.results.find((r) => r.gate === "epics-doc");
      expect(edResult!.fixes).toBeDefined();
      expect(edResult!.pass).toBe(true); // re-checked after fix
    } finally {
      fx.cleanup();
    }
  });

  test("calls runSync with fix=true for tickets gate", () => {
    const fx = makeFixture();
    try {
      let fixWasCalled = false;
      const mockSync = (
        _root: string,
        opts: { fix: boolean; verbose: boolean; ticketsPath: string; },
      ): number => {
        if (opts.fix) fixWasCalled = true;
        return opts.fix ? 0 : 1; // fail check, succeed fix
      };

      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["tickets"],
        runSync: mockSync,
        fix: true,
      });

      const ticketsResult = result.results.find((r) => r.gate === "tickets");
      expect(fixWasCalled).toBe(true);
      expect(ticketsResult!.fixes).toBeDefined();
      expect(ticketsResult!.pass).toBe(true); // trust the fix
    } finally {
      fx.cleanup();
    }
  });

  test("does not fix when fix=false (default)", () => {
    const fx = makeFixture();
    try {
      writeFileSync(fx.codeMapPath, JSON.stringify({ "src/stale.ts": [] }, null, 2));

      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["code-map"],
        runSync: () => 0,
        // fix not set — defaults to undefined
      });

      const cmResult = result.results.find((r) => r.gate === "code-map");
      expect(cmResult!.fixes).toBeUndefined();
      expect(cmResult!.pass).toBe(false);
      expect(result.fixedCount).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("does not apply fixes to non-fixable gates", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "bad-name.md"); // fails naming

      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["naming"],
        runSync: () => 0,
        fix: true,
      });

      const namingResult = result.results.find((r) => r.gate === "naming");
      expect(namingResult!.fixes).toBeUndefined();
      expect(namingResult!.pass).toBe(false);
      expect(result.fixedCount).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("reports fixedCount across multiple fixable gates", () => {
    const fx = makeFixture();
    try {
      // Make both backlog and code-map fail
      writeFileSync(
        join(fx.backlogDir, "priority.md"),
        "## File map\n\n| [tier](./tier.md) | desc |\n",
      );
      writeFileSync(join(fx.backlogDir, "tier.md"), "# Tier\n");
      writeFileSync(join(fx.backlogDir, "orphan.md"), "# Orphan\n");
      writeFileSync(fx.codeMapPath, JSON.stringify({ "src/stale.ts": [] }, null, 2));

      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: ["priority.md"],
        gates: ["backlog", "code-map"],
        runSync: () => 0,
        fix: true,
      });

      expect(result.fixedCount).toBeGreaterThanOrEqual(2);
    } finally {
      fx.cleanup();
    }
  });
});

// ── resolveFromRoot / absolute-path respect ─────────────────────

describe("resolveFromRoot", () => {
  test("joins relative configured paths onto the root", () => {
    expect(resolveFromRoot("/repo", ".plan")).toBe("/repo/.plan");
    expect(resolveFromRoot("/repo", ".plan/tickets")).toBe("/repo/.plan/tickets");
  });

  test("respects absolute configured paths instead of doubling them", () => {
    // Documents the historic bug: join() concatenates an absolute path onto
    // the root (worktree doubling), so the isAbsolute check must come first.
    expect(join("/repo", "/home/x/.plan")).toBe("/repo/home/x/.plan");
    expect(resolveFromRoot("/repo", "/home/x/.plan")).toBe("/home/x/.plan");
  });
});

// ── worktree smoke: absolute configured planDir from a worktree root ──

describe("validate / worktree path resolution", () => {
  test("absolute tickets dir outside the worktree resolves without doubling", () => {
    // Simulates the ticket evidence: `giwt plan validate` run inside
    // tree/<branch> with an absolute tickets path configured — the plan
    // files live in the main checkout, not under the worktree root.
    const wtRoot = mkdtempSync(join(tmpdir(), "giwt-wt-"));
    const mainRoot = mkdtempSync(join(tmpdir(), "giwt-main-"));
    const planDir = join(mainRoot, ".plan");
    const ticketsDir = join(planDir, "tickets");
    const epicsDir = join(planDir, "epics");
    const backlogDir = join(planDir, "backlog");
    mkdirSync(ticketsDir, { recursive: true });
    mkdirSync(epicsDir, { recursive: true });
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(
      join(ticketsDir, "TASK-good.md"),
      "# TASK-good.md\n\n**Status:** open\n**Priority:** high\n**Effort:** S\n**Summary:** x\n**Context:** y\n**Acceptance Criteria:** z\n",
    );
    try {
      const result = runValidate({
        projectRoot: wtRoot,
        worktreeRoot: wtRoot,
        ticketsDir: resolveFromRoot(wtRoot, ticketsDir),
        epicsDir: resolveFromRoot(wtRoot, epicsDir),
        backlogDir: resolveFromRoot(wtRoot, backlogDir),
        planDir: resolveFromRoot(wtRoot, planDir),
        srcDir: "src",
        codeMapPath: join(resolveFromRoot(wtRoot, planDir), "code-map.json"),
        epicsIndexPath: join(resolveFromRoot(wtRoot, planDir), "epics-index.md"),
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format"],
        runSync: () => 0,
      });
      const format = result.results[0]!;
      expect(format.gate).toBe("format");
      expect(format.pass).toBe(true);
      expect(format.findings).toEqual([]);
      // The path join() used to fabricate must not appear in any finding.
      expect(format.findings.some((f) => f.message.includes(join(wtRoot, mainRoot)))).toBe(
        false,
      );
    } finally {
      rmSync(wtRoot, { recursive: true, force: true });
      rmSync(mainRoot, { recursive: true, force: true });
    }
  });
});

// ── bounded default output ──────────────────────────────────────

describe("renderValidateSummary / bounded default output", () => {
  test("per-gate counts, capped findings, and hidden remainder pointer", () => {
    const fx = makeFixture();
    try {
      // 30 tickets each missing 5 of the 6 required sections → 150 findings.
      for (let i = 0; i < 30; i++) {
        writeTicket(fx, `TASK-bad${i}.md`, ["Status"]);
      }
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format"],
        runSync: () => 0,
      });
      const lines = renderValidateSummary(result);

      const gateLine = lines.find((l) => l.includes("format"));
      expect(gateLine).toBeDefined();
      expect(gateLine).toContain("FAIL (150 error(s))");

      const findingLines = lines.filter((l) => l.includes("missing required section"));
      expect(findingLines).toHaveLength(MAX_LISTED_FINDINGS);

      const moreLine = lines.find((l) => l.includes("more"));
      expect(moreLine).toContain(`… and ${150 - MAX_LISTED_FINDINGS} more`);
      expect(moreLine).toContain("--json");
    } finally {
      fx.cleanup();
    }
  });

  test("passing gate reports a single OK line with no findings", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-good.md");
      writeEpic(fx, "epic-good.md");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format"],
        runSync: () => 0,
      });
      const lines = renderValidateSummary(result);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("✓");
      expect(lines[0]).toContain("OK");
      expect(lines[0]).not.toContain("FAIL");
    } finally {
      fx.cleanup();
    }
  });
});

// ── --fix reports unfixed gates ─────────────────────────────────

describe("validate / --fix reports unfixed gates", () => {
  test("lists failing non-fixable gates with a manual next step", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-bad.md", ["Status"]); // format errors
      writeTicket(fx, "bad-name.md"); // naming error
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format", "naming"],
        runSync: () => 0,
        fix: true,
      });
      expect(result.unfixableGates).toEqual(["format", "naming"]);

      const lines = renderUnfixableGates(result.unfixableGates!);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("--fix cannot auto-fix 'format'");
      expect(lines[0]).toContain("**Section:**");
      expect(lines[1]).toContain("--fix cannot auto-fix 'naming'");
      expect(lines[1]).toContain("rename");

      // The bounded summary surfaces the unfixable-gate lines too.
      const summary = renderValidateSummary(result);
      expect(summary.some((l) => l.includes("cannot auto-fix 'format'"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("does not list fixable gates that --fix repaired", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.backlogDir, "priority.md"),
        "## File map\n\n| [tier](./tier.md) | desc |\n",
      );
      writeFileSync(join(fx.backlogDir, "tier.md"), "# Tier\n");
      writeFileSync(join(fx.backlogDir, "orphan.md"), "# Orphan\n");
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: ["priority.md"],
        gates: ["backlog"],
        runSync: () => 0,
        fix: true,
      });
      expect(result.fixedCount).toBeGreaterThan(0);
      expect(result.unfixableGates).toBeUndefined();
      const summary = renderValidateSummary(result);
      expect(summary.some((l) => l.includes("cannot auto-fix"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("omits unfixableGates when --fix is not set", () => {
    const fx = makeFixture();
    try {
      writeTicket(fx, "TASK-bad.md", ["Status"]);
      const result = runValidate({
        projectRoot: fx.root,
        worktreeRoot: fx.root,
        ticketsDir: fx.ticketsDir,
        epicsDir: fx.epicsDir,
        backlogDir: fx.backlogDir,
        planDir: fx.planDir,
        srcDir: "src",
        codeMapPath: fx.codeMapPath,
        epicsIndexPath: fx.epicsIndexPath,
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["format"],
        runSync: () => 0,
      });
      expect(result.pass).toBe(false);
      expect(result.unfixableGates).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });
});
