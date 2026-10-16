// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Unit tests for interconnect reference resolution: index-backed extid
 * mapping, degraded modes (missing/unparseable index), and resolveRef's
 * escape / exact / unique-prefix / ambiguous / unresolved branches.
 *
 * Resource contract: every test owns a mkdtemp fixture (parallel-safe),
 * released in finally.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../../utils/scratch-tmp";
import type { SnapshotFile } from "./build";
import { buildResolution, type ResolutionMaps, resolveRef } from "./resolve";
import type { InterconnectFinding } from "./types";

function snapshot(rels: string[]): SnapshotFile[] {
  return rels.map((rel) => ({ rel, abs: `/${rel}`, text: "" }));
}

function maps(
  bySlug: Record<string, string>,
  byExtid: Record<string, string> = {},
): ResolutionMaps {
  return { bySlug: new Map(Object.entries(bySlug)), byExtid: new Map(Object.entries(byExtid)) };
}

describe("buildResolution", () => {
  test("undefined index path resolves slugs only, no findings", () => {
    const findings: InterconnectFinding[] = [];
    const res = buildResolution(snapshot([".plan/tickets/TASK-one.md"]), undefined, findings);
    expect(res.bySlug.get("TASK-one")).toBe(".plan/tickets/TASK-one.md");
    expect(res.byExtid.size).toBe(0);
    expect(findings).toEqual([]);
  });

  test("missing index file degrades with a warn finding", () => {
    const findings: InterconnectFinding[] = [];
    const res = buildResolution(
      snapshot([".plan/tickets/TASK-one.md"]),
      join(scratchRoot(), "definitely-missing-index.json"),
      findings,
    );
    expect(res.byExtid.size).toBe(0);
    expect(findings[0]?.message).toContain("ticket index missing");
  });

  test("unparseable index degrades with a warn finding", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-icresolve-"));
    try {
      const indexPath = join(root, "index.json");
      writeFileSync(indexPath, "{ not json");
      const findings: InterconnectFinding[] = [];
      const res = buildResolution(snapshot([]), indexPath, findings);
      expect(res.byExtid.size).toBe(0);
      expect(findings[0]?.message).toContain("unparseable ticket index");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("index entries map extids to snapshot nodes via source basename", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-icresolve-"));
    try {
      const indexPath = join(root, "index.json");
      writeFileSync(
        indexPath,
        JSON.stringify({
          "EXT-1": { source: ".plan/tickets/TASK-one.md" },
          "EXT-2": { source: ".plan/tickets/TASK-gone.md" },
          "EXT-3": {},
        }),
      );
      const findings: InterconnectFinding[] = [];
      const res = buildResolution(
        snapshot([".plan/tickets/TASK-one.md"]),
        indexPath,
        findings,
      );
      expect(res.byExtid.get("EXT-1")).toBe(".plan/tickets/TASK-one.md");
      expect(res.byExtid.has("EXT-2")).toBe(false);
      expect(res.byExtid.has("EXT-3")).toBe(false);
      expect(findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveRef", () => {
  const findings: InterconnectFinding[] = [];
  const res = buildResolution(
    snapshot([".plan/tickets/FEAT-036-add-foo.md", ".plan/tickets/TASK-one.md"]),
    undefined,
    findings,
  );

  test("path-escaping refs are rejected with an error finding", () => {
    expect(resolveRef("a.md", "../outside", res, findings)).toBeNull();
    expect(findings[0]?.message).toContain("escapes the plan root");
  });

  test("exact slug, extid, and unique prefix all resolve", () => {
    expect(resolveRef("a.md", "TASK-one", res, [])).toBe(".plan/tickets/TASK-one.md");
    expect(resolveRef("a.md", ".plan/tickets/TASK-one.md", res, [])).toBe(
      ".plan/tickets/TASK-one.md",
    );
    expect(resolveRef("a.md", "FEAT-036", res, [])).toBe(".plan/tickets/FEAT-036-add-foo.md");
  });

  test("ambiguous prefix and unresolved refs produce error findings", () => {
    const amb: InterconnectFinding[] = [];
    expect(resolveRef(
      "a.md",
      "TASK",
      maps({
        "TASK-one": ".plan/tickets/TASK-one.md",
        "TASK-two": ".plan/tickets/TASK-two.md",
      }),
      amb,
    )).toBeNull();
    expect(amb[0]?.message).toContain("is ambiguous");

    const none: InterconnectFinding[] = [];
    expect(resolveRef("a.md", "TASK-nine", res, none)).toBeNull();
    expect(none[0]?.message).toContain("resolves to no plan file");
  });
});
