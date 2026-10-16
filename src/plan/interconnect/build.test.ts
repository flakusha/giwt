// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Interconnect graph derivation tests: **Related:** parser dialect, edge
 * direction (consumes needs a Related link over a shared src path; co-
 * owners without direction are siblings), deterministic dedupe, security
 * rejections, and the pure queries. Resource contract: every test owns a
 * mkdtemp fixture (parallel-safe).
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../../utils/scratch-tmp";
import {
  buildInterconnect,
  edgesTouching,
  nodeReport,
  renderInterconnectJson,
  resolveRef,
  siblingsOf,
  verifySnapshotStable,
  whoConsumes,
  whoProduces,
} from "../interconnect";
import { snapshotInterconnectInputs } from "../interconnect/build";
import type { ResolutionMaps } from "../interconnect/resolve";
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

describe("interconnect determinism", () => {
  test("repeated builds are byte-identical", () => {
    const fx = makeFixture();
    try {
      writeSharedFixture(fx);
      const a = renderInterconnectJson(buildInterconnect(fx.opts));
      const b = renderInterconnectJson(buildInterconnect(fx.opts));
      expect(a).toBe(b);
      // Versioned artifact with a trailing newline (byte-stable contract)
      expect(a).toContain("\"version\": 1");
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
