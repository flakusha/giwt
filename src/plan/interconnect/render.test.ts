// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Unit tests for interconnect markdown rendering and the first-difference
 * reporter: the shared-src hub table, edge table cells (with and without
 * `via`), and firstDiffLine's hit and no-difference branches.
 */

import { describe, expect, test } from "bun:test";
import { firstDiffLine, renderInterconnectMd } from "./render";
import type { InterconnectGraph } from "./types";

function graph(): InterconnectGraph {
  return {
    nodes: [
      {
        id: "TASK-one",
        kind: "ticket",
        path: ".plan/tickets/TASK-one.md",
        title: "one",
        status: "not-started",
        srcRefs: ["src/one.ts"],
        related: ["TASK-two"],
      },
      {
        id: "TASK-two",
        kind: "ticket",
        path: ".plan/tickets/TASK-two.md",
        title: "two",
        status: "not-started",
        srcRefs: ["src/one.ts"],
        related: [],
      },
    ],
    srcNodes: [
      { path: "src/one.ts", owners: ["TASK-one", "TASK-two"] },
    ],
    edges: [
      { from: "TASK-one", kind: "produces", to: "src/one.ts" },
      { from: "TASK-one", kind: "sibling", to: "TASK-two", via: "src/one.ts" },
      { from: "TASK-one", kind: "related", to: "TASK-two" },
    ],
    findings: [],
  };
}

describe("renderInterconnectMd", () => {
  test("renders hub table, edge table, and header", () => {
    const md = renderInterconnectMd(graph(), "gen-header\n");
    expect(md).toContain("gen-header");
    expect(md).toContain("## Shared src hubs");
    expect(md).toContain("| `src/one.ts` | `TASK-one`, `TASK-two` |");
    expect(md).toContain("| `TASK-one` | produces | `src/one.ts` | - |");
    expect(md).toContain("| `TASK-one` | sibling | `TASK-two` | `src/one.ts` |");
    expect(md).toContain("edges: produces 1, consumes 0, sibling 1, owns 0, related 1");
  });

  test("renders the empty-hub and no-edge fallbacks", () => {
    const g = graph();
    g.srcNodes = [];
    g.edges = [];
    const md = renderInterconnectMd(g, "");
    expect(md).toContain("(no src path is owned by more than one plan node)");
    expect(md).toContain("(no edges derived)");
  });
});

describe("firstDiffLine", () => {
  test("reports the first differing line, 1-based", () => {
    expect(firstDiffLine("a\nb\nc", "a\nX\nc")).toBe(2);
    expect(firstDiffLine("a", "a\nb")).toBe(2);
  });

  test("returns null for identical inputs", () => {
    expect(firstDiffLine("a\nb", "a\nb")).toBeNull();
  });
});
