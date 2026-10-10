// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orphan detection (detectors + the tickets-gate integration). The
 * advisory-first policy is asserted NEGATIVELY and mandatorily: orphan
 * findings are warn-level and the tickets gate STAYS GREEN with orphans
 * present.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIndexStamp } from "../../tickets/index-stamp";
import { checkOrphans } from "./orphan-gate";
import { runValidate } from "./run";
import type { ValidateOptions } from "./types";

describe("checkOrphans", () => {
  test("flags orphan tags (case-insensitive, placeholders excluded) and orphan bindings", () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-orphans-"));
    try {
      const tickets = join(root, "t");
      const epics = join(root, "e");
      mkdirSync(tickets, { recursive: true });
      mkdirSync(epics, { recursive: true });
      writeFileSync(join(tickets, "A.md"), "**Tags:** chat\n");
      writeFileSync(
        join(tickets, "index.json"),
        JSON.stringify({
          "A": { tags: ["chat", "ghost"], epic: "" },
          "B": { tags: ["(none)", "tbd"], epic: "epic-real.md (core)" },
          "C": { tags: [], epic: "epic-missing" },
        }),
      );
      writeFileSync(join(epics, "epic-real.md"), "# EPIC\n");
      const findings = checkOrphans({ ticketsDir: tickets, epicsDir: epics });
      expect(findings.every((f) => f.level === "warn" && f.gate === "tickets")).toBe(true);
      expect(findings.some((f) => f.message.includes("A: orphan tag \"ghost\""))).toBe(true);
      expect(findings.some((f) => f.message.includes("C: orphan epic binding"))).toBe(true);
      // B: placeholders are not orphan tags; epic-real.md resolves.
      expect(findings.some((f) => f.message.startsWith("B:"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing index yields no findings", () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-orphans-"));
    try {
      expect(checkOrphans({
        ticketsDir: join(root, "none"),
        epicsDir: join(root, "none"),
      })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a hand-edited index (stamp mismatch) is reported, never parsed", () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-orphans-stamp-"));
    try {
      const tickets = join(root, "t");
      const epics = join(root, "e");
      mkdirSync(tickets, { recursive: true });
      mkdirSync(epics, { recursive: true });
      const indexPath = join(tickets, "index.json");
      writeFileSync(indexPath, JSON.stringify({ "A": { tags: ["chat"], epic: "" } }));
      writeIndexStamp(indexPath);
      // Out-of-band edit AFTER the stamp — must not be silently aggregated.
      writeFileSync(indexPath, JSON.stringify({ "A": { tags: ["ghost-edit"], epic: "" } }));

      const findings = checkOrphans({ ticketsDir: tickets, epicsDir: epics });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.level).toBe("warn");
      expect(findings[0]!.gate).toBe("tickets");
      expect(findings[0]!.message).toContain("frontmatter is source of truth");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("tickets gate integration (advisory-first)", () => {
  test("orphan findings are reported as warnings and the gate does NOT fail", () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-orphans-gate-"));
    try {
      const tickets = join(root, "tickets");
      const epics = join(root, "epics");
      mkdirSync(tickets, { recursive: true });
      mkdirSync(epics, { recursive: true });
      writeFileSync(
        join(tickets, "index.json"),
        JSON.stringify({
          "A": { tags: ["ghost-tag"], epic: "epic-nowhere" },
        }),
      );
      const opts = {
        projectRoot: root,
        worktreeRoot: root,
        ticketsDir: tickets,
        epicsDir: epics,
        backlogDir: join(root, "backlog"),
        planDir: root,
        srcDir: join(root, "src"),
        codeMapPath: join(root, "code-map.md"),
        epicsIndexPath: join(root, "epics-index.md"),
        mapSources: [],
        linkScanDirs: [],
        backlogIndexFiles: [],
        gates: ["tickets"],
        // In-sync stub: the sync half of the gate passes.
        runSync: () => 0,
      } as unknown as ValidateOptions;
      const result = runValidate(opts);
      const gate = result.results.find((r) => r.gate === "tickets");
      expect(gate).toBeDefined();
      // MANDATORY advisory assertion: orphans present, gate still green.
      expect(gate!.pass).toBe(true);
      expect(result.pass).toBe(true);
      expect(gate!.findings.length).toBe(2);
      expect(gate!.findings.every((f) => f.level === "warn")).toBe(true);
      expect(gate!.findings.some((f) => f.message.includes("advisory"))).toBe(true);
      expect(result.issueCount).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
