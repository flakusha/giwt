// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Interconnect graph derivation tests: **Related:** parser dialect, edge
 * direction (consumes needs a Related link over a shared src path; co-
 * owners without direction are siblings), deterministic dedupe, security
 * rejections, and the pure queries. Resource contract: every test owns a
 * mkdtemp fixture (parallel-safe).
 */

import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../../utils/scratch-tmp";
import {
  buildInterconnect,
  edgesTouching,
  interconnectOutputs,
  nodeReport,
  renderInterconnectJson,
  resolveRef,
  siblingsOf,
  verifySnapshotStable,
  whoConsumes,
  whoProduces,
} from "../interconnect";
import type { ResolutionMaps } from "../interconnect/resolve";
import { snapshotInterconnectInputs } from "../interconnect/snapshot";
import type { InterconnectFinding, InterconnectOptions } from "../interconnect/types";

function makeFixture(): { root: string; opts: InterconnectOptions; cleanup: () => void; } {
  const root = mkdtempSync(join(scratchRoot(), "giwt-interconnect-"));
  const planDir = join(root, ".plan");
  const ticketsDir = join(planDir, "tickets");
  const epicsDir = join(planDir, "epics");
  mkdirSync(ticketsDir, { recursive: true });
  mkdirSync(epicsDir, { recursive: true });
  return {
    root,
    opts: {
      projectRoot: root,
      ticketsDir,
      epicsDir,
      codeMapPath: join(planDir, "code-map.json"),
      indexPath: join(planDir, "tickets", "index.json"),
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function ticket(name: string, fields: Record<string, string>): string {
  const lines = [`# FEAT-${name}: ${name}`, ""];
  for (const [k, v] of Object.entries(fields)) lines.push(`**${k}:** ${v}`);
  lines.push("", "**Summary:**", "", "body.", "");
  return lines.join("\n");
}

/** Canonical three-ticket fixture: a Related-names b; a, b, c all own
 * src/shared.ts; a additionally owns src/a.ts; a binds to epic-core. */
function writeSharedFixture(fx: ReturnType<typeof makeFixture>): void {
  writeFileSync(
    join(fx.opts.ticketsDir, "FEAT-a.md"),
    ticket("a", {
      Status: "In Progress",
      Epic: "epic-core",
      Related: "FEAT-b",
    }),
  );
  writeFileSync(join(fx.opts.ticketsDir, "FEAT-b.md"), ticket("b", { Status: "Not Started" }));
  writeFileSync(join(fx.opts.ticketsDir, "FEAT-c.md"), ticket("c", { Status: "Done" }));
  writeFileSync(
    join(fx.opts.epicsDir, "epic-core.md"),
    "# EPIC: core\n\n**Status:** In Progress\n**Priority:** high\n**Effort:** Large\n**Type:** epic\n**Tags:** core\n**Overview:** x\n",
  );
  writeFileSync(
    fx.opts.codeMapPath,
    JSON.stringify(
      {
        "src/a.ts": [{ kind: "ticket", source: ".plan/tickets/FEAT-a.md" }],
        "src/shared.ts": [
          { kind: "ticket", source: ".plan/tickets/FEAT-a.md" },
          { kind: "ticket", source: ".plan/tickets/FEAT-b.md" },
          { kind: "ticket", source: ".plan/tickets/FEAT-c.md" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
}

describe("interconnect edges", () => {
  test("shared src + Related direction yields produces/consumes/sibling/owns", () => {
    const fx = makeFixture();
    try {
      writeSharedFixture(fx);
      const g = buildInterconnect(fx.opts);
      const has = (from: string, kind: string, to: string, via?: string) =>
        g.edges.some((e) =>
          e.from === from && e.kind === kind && e.to === to && (via === undefined || e.via === via)
        );
      // produces: code-map ownership, direction node → src
      expect(has("FEAT-a", "produces", "src/a.ts")).toBe(true);
      expect(has("FEAT-b", "produces", "src/shared.ts")).toBe(true);
      // related: raw resolved link
      expect(has("FEAT-a", "related", "FEAT-b")).toBe(true);
      // consumes: a Related-names b AND they share src/shared.ts
      expect(has("FEAT-a", "consumes", "FEAT-b", "src/shared.ts")).toBe(true);
      // sibling: co-owners without a Related direction (one edge, a < c)
      expect(has("FEAT-a", "sibling", "FEAT-c", "src/shared.ts")).toBe(true);
      expect(has("FEAT-b", "sibling", "FEAT-c", "src/shared.ts")).toBe(true);
      expect(g.edges.some((e) => e.kind === "sibling" && e.from === "FEAT-c")).toBe(false);
      // owns: epic membership from **Epic:**
      expect(has("epic-core", "owns", "FEAT-a")).toBe(true);
      // a consumes b ⇒ NOT sibling; no reverse consume without a link
      expect(has("FEAT-b", "consumes", "FEAT-a")).toBe(false);
      // only the missing-index warn (by design); no errors
      expect(g.findings.filter((f) => f.level === "error")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("multiple shared src paths dedupe into one edge with via joined", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-a.md"), ticket("a", { Related: "FEAT-b" }));
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-b.md"), ticket("b", {}));
      writeFileSync(
        fx.opts.codeMapPath,
        JSON.stringify({
          "src/x.ts": [
            { kind: "ticket", source: ".plan/tickets/FEAT-a.md" },
            { kind: "ticket", source: ".plan/tickets/FEAT-b.md" },
          ],
          "src/y.ts": [
            { kind: "ticket", source: ".plan/tickets/FEAT-a.md" },
            { kind: "ticket", source: ".plan/tickets/FEAT-b.md" },
          ],
        }),
      );
      const g = buildInterconnect(fx.opts);
      const consumes = g.edges.filter((e) => e.kind === "consumes");
      expect(consumes).toHaveLength(1);
      expect(consumes[0]!.via).toBe("src/x.ts; src/y.ts");
    } finally {
      fx.cleanup();
    }
  });
});

describe("interconnect Related dialect", () => {
  test("resolves slug, .md, .plan/-prefixed, and index-extid forms", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.opts.ticketsDir, "FEAT-a.md"),
        ticket("a", { Related: "FEAT-b, FEAT-c.md, .plan/tickets/FEAT-d.md" }),
      );
      for (const n of ["b", "c", "d"]) {
        writeFileSync(join(fx.opts.ticketsDir, `FEAT-${n}.md`), ticket(n, {}));
      }
      const g = buildInterconnect(fx.opts);
      const rel = g.nodes.find((n) => n.id === "FEAT-a")!.related;
      expect(rel).toEqual(["FEAT-b", "FEAT-c", "FEAT-d"]);
      // missing index/code-map warn by design; only errors matter here
      expect(g.findings.filter((f) => f.level === "error")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("unique typed-id prefix resolves; ambiguity and dangling are findings", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-036-add-foo.md"), ticket("036-add-foo", {}));
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-036-add-bar.md"), ticket("036-add-bar", {}));
      writeFileSync(
        join(fx.opts.ticketsDir, "FEAT-src.md"),
        ticket("src", { Related: "FEAT-036-add, FEAT-ghost, epic" }),
      );
      const g = buildInterconnect(fx.opts);
      const msgs = g.findings.map((f) => f.message);
      // FEAT-036-add prefixes both 036 tickets → ambiguous, never guessed
      expect(msgs.some((m) => m.includes("'FEAT-036-add' is ambiguous"))).toBe(true);
      expect(msgs.some((m) => m.includes("'FEAT-ghost' resolves to no plan file"))).toBe(true);
      // bare `epic` is prose-shaped — not a ref token at all
      expect(msgs.some((m) => m.includes("'epic'"))).toBe(false);
      // every **Related:** finding names file + field + path (code-map
      // warn findings are a different field and already covered above)
      for (const f of g.findings.filter((x) => x.field === "**Related:**")) {
        expect(f.file).toContain("FEAT-src.md");
        expect(f.level).toBe("error");
      }
    } finally {
      fx.cleanup();
    }
  });

  test("path escapes are rejected with file/field/path and never followed", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.opts.ticketsDir, "FEAT-esc.md"),
        ticket("esc", { Related: "../../../etc/passwd.md, /abs/path.md, ok.md" }),
      );
      writeFileSync(join(fx.opts.ticketsDir, "ok.md"), ticket("ok", {}));
      const g = buildInterconnect(fx.opts);
      // Slash-bearing tokens never tokenize — no ref leaves the plan dirs.
      expect(g.nodes.find((n) => n.id === "FEAT-esc")!.related).toEqual(["ok"]);
      expect(g.edges.filter((e) => e.to.includes("etc") || e.to.includes("abs"))).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("resolveRef rejects absolute and ..-climb targets explicitly", () => {
    const findings: InterconnectFinding[] = [];
    const res: ResolutionMaps = {
      bySlug: new Map([["ok", ".plan/tickets/ok.md"]]),
      byExtid: new Map(),
    };
    expect(resolveRef("FEAT-x.md", "/abs/path.md", res, findings)).toBeNull();
    expect(resolveRef("FEAT-x.md", "../outside.md", res, findings)).toBeNull();
    expect(resolveRef("FEAT-x.md", "C:\\win.md", res, findings)).toBeNull();
    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.level).toBe("error");
      expect(f.file).toBe("FEAT-x.md");
      expect(f.field).toBe("**Related:**");
      expect(f.message).toContain("escapes the plan root");
    }
    expect(resolveRef("FEAT-x.md", "ok.md", res, [])).toBe(".plan/tickets/ok.md");
  });
});

describe("interconnect artifacts (**Generates:**)", () => {
  test("declared targets become artifact nodes with generates edges", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.opts.ticketsDir, "FEAT-a.md"),
        ticket("a", { Generates: "dist/bundle.js, .plan/matrix.md, dist/bundle.js" }),
      );
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-b.md"), ticket("b", {}));
      const g = buildInterconnect(fx.opts);
      const arts = g.nodes.filter((n) => n.kind === "artifact");
      expect(arts.map((n) => n.id)).toEqual([".plan/matrix.md", "dist/bundle.js"]);
      for (const a of arts) {
        expect(a.path).toBe(a.id);
        expect(a.status).toBe("declared");
        expect(a.srcRefs).toEqual([]);
        expect(a.related).toEqual([]);
      }
      // Declaration-only: the artifact never has to exist on disk, and a
      // clean declaration produces no findings.
      expect(g.findings.filter((f) => f.level === "error")).toEqual([]);
      expect(g.edges.filter((e) => e.kind === "generates")).toEqual([
        { from: "FEAT-a", kind: "generates", to: ".plan/matrix.md" },
        { from: "FEAT-a", kind: "generates", to: "dist/bundle.js" },
      ]);
      // Declared-but-absent artifacts stay queryable through the node report.
      expect(nodeReport(g, "dist/bundle.js")!.node.kind).toBe("artifact");
      expect(edgesTouching(g, "dist/bundle.js")).toHaveLength(1);
      // JSON round-trip carries the new node kind, edge kind, and the
      // sparse `generates` list on the declaring node.
      const parsed = JSON.parse(renderInterconnectJson(g)) as {
        version: number;
        nodes: { id: string; kind: string; generates?: string[]; }[];
        edges: { kind: string; }[];
      };
      expect(parsed.version).toBe(2);
      expect(parsed.nodes.find((n) => n.id === "FEAT-a")!.generates).toEqual([
        ".plan/matrix.md",
        "dist/bundle.js",
      ]);
      expect(parsed.nodes.find((n) => n.id === "FEAT-b")!.generates).toBeUndefined();
      expect(parsed.edges.some((e) => e.kind === "generates")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("path escapes and plan-node collisions are error findings, never nodes", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.opts.ticketsDir, "FEAT-a.md"),
        ticket("a", { Generates: "../evil.md, /abs/x.md, C:\\win.md, FEAT-b" }),
      );
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-b.md"), ticket("b", {}));
      const g = buildInterconnect(fx.opts);
      expect(g.nodes.filter((n) => n.kind === "artifact")).toEqual([]);
      expect(g.edges.some((e) => e.kind === "generates")).toBe(false);
      const genFindings = g.findings.filter((f) => f.field === "**Generates:**");
      expect(genFindings).toHaveLength(4);
      for (const f of genFindings) {
        expect(f.level).toBe("error");
        expect(f.file).toBe(".plan/tickets/FEAT-a.md");
      }
      expect(genFindings.some((f) => f.message.includes("'../evil.md' escapes"))).toBe(true);
      expect(genFindings.some((f) => f.message.includes("'/abs/x.md' escapes"))).toBe(true);
      expect(genFindings.some((f) => f.message.includes("'C:/win.md' escapes"))).toBe(true);
      expect(
        genFindings.some((f) => f.message.includes("'FEAT-b' names an existing plan node")),
      ).toBe(true);
      // The declaration stays on the record (only escapes are dropped at
      // parse level); the collision suppresses the artifact node + edge.
      expect(g.nodes.find((n) => n.id === "FEAT-a")!.generates).toEqual(["FEAT-b"]);
    } finally {
      fx.cleanup();
    }
  });

  test("several declarers share one artifact node; epics may declare too", () => {
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.opts.ticketsDir, "FEAT-a.md"),
        ticket("a", { Generates: ".plan/interconnect.json" }),
      );
      writeFileSync(
        join(fx.opts.epicsDir, "epic-core.md"),
        "# EPIC: core\n\n**Status:** In Progress\n**Generates:** .plan/interconnect.json\n\n**Overview:** x\n",
      );
      const g = buildInterconnect(fx.opts);
      expect(g.nodes.filter((n) => n.kind === "artifact")).toHaveLength(1);
      const gen = g.edges.filter((e) => e.kind === "generates");
      expect(gen).toHaveLength(2);
      expect(new Set(gen.map((e) => e.from))).toEqual(new Set(["FEAT-a", "epic-core"]));
      expect(g.findings.filter((f) => f.level === "error")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("interconnect matrix-derived siblings", () => {
  /** Ticket-index fixture; keys are extids, values only the fields
   * buildMatrix consumes (source/tags/epic) — or null for hand-corrupted
   * entries. */
  function writeIndex(
    fx: ReturnType<typeof makeFixture>,
    entries: Record<string, { source?: string; tags?: string[]; epic?: string; } | null>,
  ): void {
    writeFileSync(join(fx.opts.ticketsDir, "index.json"), JSON.stringify(entries));
  }

  test("shared tag and epic rows derive sibling edges with provenance", () => {
    const fx = makeFixture();
    try {
      for (const n of ["a", "b", "c", "d"]) {
        writeFileSync(join(fx.opts.ticketsDir, `FEAT-${n}.md`), ticket(n, {}));
      }
      writeIndex(fx, {
        "FEAT-A": { source: ".plan/tickets/FEAT-a.md", tags: ["x"] },
        "FEAT-B": { source: ".plan/tickets/FEAT-b.md", tags: ["x"], epic: "e1" },
        "FEAT-C": { source: ".plan/tickets/FEAT-c.md", tags: ["y"], epic: "e1" },
        "FEAT-D": { source: ".plan/tickets/FEAT-d.md", tags: ["y"], epic: "e1" },
      });
      const g = buildInterconnect(fx.opts);
      const derived = g.edges.filter((e) => e.derived === true);
      expect(derived.map((e) => [e.from, e.to, e.via])).toEqual([
        ["FEAT-a", "FEAT-b", "tag:x"],
        ["FEAT-b", "FEAT-c", "epic:e1"],
        ["FEAT-b", "FEAT-d", "epic:e1"],
        ["FEAT-c", "FEAT-d", "epic:e1; tag:y"],
      ]);
      for (const e of derived) expect(e.kind).toBe("sibling");
      // Pairs without a shared row get nothing.
      expect(g.edges.some((e) => e.from === "FEAT-a" && e.to === "FEAT-c")).toBe(false);
      expect(g.edges.some((e) => e.from === "FEAT-a" && e.to === "FEAT-d")).toBe(false);
      // Query surface: derived siblings answer --siblings like any other.
      expect(siblingsOf(g, "FEAT-b")!.map((e) => (e.from === "FEAT-b" ? e.to : e.from))).toEqual([
        "FEAT-a",
        "FEAT-c",
        "FEAT-d",
      ]);
      expect(g.findings.filter((f) => f.level === "error")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("declared direction beats derivation and shared-src siblings never duplicate", () => {
    const fx = makeFixture();
    try {
      // a Related-names b; a, b, c share src/shared.ts (a↔c, b↔c src
      // siblings); every ticket additionally shares tag "shared" with d.
      writeSharedFixture(fx);
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-d.md"), ticket("d", {}));
      writeIndex(fx, {
        "FEAT-A": {
          source: ".plan/tickets/FEAT-a.md",
          tags: ["shared"],
          epic: "epic-core",
        },
        "FEAT-B": { source: ".plan/tickets/FEAT-b.md", tags: ["shared"] },
        "FEAT-C": { source: ".plan/tickets/FEAT-c.md", tags: ["shared"] },
        "FEAT-D": { source: ".plan/tickets/FEAT-d.md", tags: ["shared"] },
      });
      const g = buildInterconnect(fx.opts);
      const derived = g.edges.filter((e) => e.derived === true);
      // Only pairs with no stronger record derive: a-b is Related-directed,
      // a-c and b-c already sibling via src/shared.ts — d is the new fact.
      expect(derived.map((e) => [e.from, e.to, e.via])).toEqual([
        ["FEAT-a", "FEAT-d", "tag:shared"],
        ["FEAT-b", "FEAT-d", "tag:shared"],
        ["FEAT-c", "FEAT-d", "tag:shared"],
      ]);
      // The declared/ownership edges stay exactly as ticket 3 built them.
      expect(g.edges.some((e) => e.kind === "consumes" && e.from === "FEAT-a")).toBe(true);
      expect(
        g.edges.some((e) => e.kind === "sibling" && e.via === "src/shared.ts" && !e.derived),
      ).toBe(true);
      expect(g.edges.filter((e) => e.kind === "owns")).toEqual([
        { from: "epic-core", kind: "owns", to: "FEAT-a" },
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test("no sibling input leaves the graph at its ticket-3 state", () => {
    const fx = makeFixture();
    try {
      writeSharedFixture(fx);
      const withoutIndex = buildInterconnect(fx.opts);
      expect(withoutIndex.edges.some((e) => e.derived === true)).toBe(false);
      // An index with disjoint rows derives nothing either.
      writeIndex(fx, {
        "FEAT-A": { source: ".plan/tickets/FEAT-a.md", tags: ["t1"], epic: "e1" },
        "FEAT-B": { source: ".plan/tickets/FEAT-b.md", tags: ["t2"], epic: "e2" },
        "FEAT-C": { source: ".plan/tickets/FEAT-c.md", tags: ["t3"], epic: "e3" },
      });
      const disjoint = buildInterconnect(fx.opts);
      expect(disjoint.edges.some((e) => e.derived === true)).toBe(false);
      // Synthetic untagged/unbound rows are noise, never sibling facts.
      writeIndex(fx, {
        "FEAT-A": { source: ".plan/tickets/FEAT-a.md", tags: [], epic: "" },
        "FEAT-B": { source: ".plan/tickets/FEAT-b.md", epic: "" },
      });
      const synthetic = buildInterconnect(fx.opts);
      expect(synthetic.edges.some((e) => e.derived === true)).toBe(false);
      expect(synthetic.edges.some((e) => e.via?.includes("tag:") || e.via?.includes("epic:")))
        .toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("stale and duplicate index entries derive nothing spurious", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-a.md"), ticket("a", {}));
      writeIndex(fx, {
        // Ghost source: names no plan file — dropped, no edge, no finding.
        "FEAT-GHOST": { source: ".plan/tickets/FEAT-ghost.md", tags: ["t"] },
        "FEAT-A1": { source: ".plan/tickets/FEAT-a.md", tags: ["t"] },
        "FEAT-A2": { source: ".plan/tickets/FEAT-a.md", tags: ["t"] },
      });
      const g = buildInterconnect(fx.opts);
      expect(g.edges.some((e) => e.derived === true)).toBe(false);
      expect(g.edges.some((e) => e.from === e.to)).toBe(false);
      expect(g.findings.filter((f) => f.level === "error")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
  test("null-valued index entries degrade to no derived edges, never a throw", () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-a.md"), ticket("a", {}));
      // A hand-corrupted entry must not turn the degraded-index warn into a
      // links CLI crash: buildMatrix dereferences entry fields.
      writeIndex(fx, {
        "FEAT-A": { source: ".plan/tickets/FEAT-a.md", tags: ["t"] },
        BROKEN: null,
      });
      const g = buildInterconnect(fx.opts);
      expect(g.edges.some((e) => e.derived === true)).toBe(false);
      expect(g.findings.filter((f) => f.level === "error")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("interconnect determinism", () => {
  test("repeated builds are byte-identical", () => {
    const fx = makeFixture();
    try {
      writeSharedFixture(fx);
      const a = renderInterconnectJson(buildInterconnect(fx.opts));
      const b = renderInterconnectJson(buildInterconnect(fx.opts));
      expect(a).toBe(b);
      // Versioned artifact with a trailing newline (byte-stable contract)
      expect(a).toContain("\"version\": 2");
      expect(a.endsWith("\n")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

describe("interconnect snapshot (TOCTOU)", () => {
  test("divergence after the snapshot throws naming the file", () => {
    const fx = makeFixture();
    try {
      writeSharedFixture(fx);
      const snap = snapshotInterconnectInputs(fx.opts);
      expect(() => verifySnapshotStable(snap)).not.toThrow();
      writeFileSync(join(fx.opts.ticketsDir, "FEAT-a.md"), "# FEAT-a: changed\n");
      expect(() => verifySnapshotStable(snap)).toThrow(
        /FEAT-a\.md: changed during interconnect scan/,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("interconnectOutputs verifies the snapshot it built from — a mid-flight write is detected", () => {
    const fx = makeFixture();
    try {
      writeSharedFixture(fx);
      const target = join(fx.opts.ticketsDir, "FEAT-a.md");
      // Simulate a concurrent writer landing INSIDE interconnectOutputs:
      // the 1st read of FEAT-a.md is the snapshot phase, the 2nd is the
      // verify re-read — that one sees the mutation, and the guard must
      // compare it against the bytes the graph was actually built from.
      const realReadFileSync = fs.readFileSync;
      let targetReads = 0;
      const spy = spyOn(fs, "readFileSync").mockImplementation(
        ((path: unknown, options: unknown) => {
          if (path === target) {
            targetReads++;
            if (targetReads === 2) return "# FEAT-a: changed concurrently\n";
          }
          return realReadFileSync(path as never, options as never);
        }) as unknown as typeof fs.readFileSync,
      );
      try {
        expect(() => interconnectOutputs(fx.opts)).toThrow(
          /FEAT-a\.md: changed during interconnect scan/,
        );
        expect(targetReads).toBe(2);
      } finally {
        spy.mockRestore();
      }
    } finally {
      fx.cleanup();
    }
  });
});

describe("interconnect queries", () => {
  test("whoProduces/whoConsumes/siblings/nodeReport answer both target kinds", () => {
    const fx = makeFixture();
    try {
      writeSharedFixture(fx);
      const g = buildInterconnect(fx.opts);
      // src-path targets: owners / dependency-consumers
      expect(whoProduces(g, "src/shared.ts")).toEqual(["FEAT-a", "FEAT-b", "FEAT-c"]);
      expect(whoProduces(g, "src/a.ts")).toEqual(["FEAT-a"]);
      expect(whoConsumes(g, "src/shared.ts")).toEqual(["FEAT-a"]);
      // node targets: producer = the node it consumes from; consumers = dependents
      expect(whoProduces(g, "FEAT-a")).toEqual(["FEAT-b"]);
      expect(whoConsumes(g, "FEAT-b")).toEqual(["FEAT-a"]);
      // siblings of b: c only (a is a Related direction, not a sibling)
      expect(siblingsOf(g, "FEAT-b")!.map((e) => (e.from === "FEAT-b" ? e.to : e.from))).toEqual([
        "FEAT-c",
      ]);
      // --for report touches every edge kind
      const report = nodeReport(g, "FEAT-a");
      expect(report!.node.srcRefs.sort()).toEqual(["src/a.ts", "src/shared.ts"]);
      expect(edgesTouching(g, "FEAT-a").length).toBeGreaterThanOrEqual(4);
      // unknown targets answer null
      expect(whoProduces(g, "nope")).toBeNull();
      expect(whoConsumes(g, "nope")).toBeNull();
      expect(siblingsOf(g, "nope")).toBeNull();
      expect(nodeReport(g, "nope")).toBeNull();
    } finally {
      fx.cleanup();
    }
  });
});
