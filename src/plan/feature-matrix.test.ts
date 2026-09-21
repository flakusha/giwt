// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/plan/feature-matrix.ts — the pure ticket-index projection,
 * its markdown rendering, and the `matrix` validate gate.
 *
 * Resource contract (parallel-safe): gate tests each own a mkdtemp .plan
 * fixture torn down in afterEach; the pure buildMatrix/render tests touch
 * no filesystem at all.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IndexEntry } from "../tickets/sync-ticket";
import { buildMatrix, generateMatrixMarkdown, genMatrix, matrixOutput } from "./feature-matrix";
import { ALL_GATES, runValidate } from "./validate";

function entry(overrides: Partial<IndexEntry> & { extid: string; }): IndexEntry {
  return {
    hash: "0000000",
    type: "FEAT",
    title: overrides.extid.toLowerCase(),
    label: "feat",
    priority: "medium",
    epic: "",
    tags: [],
    source: `.plan/tickets/${overrides.extid}.md`,
    status: "open",
    ...overrides,
  };
}

describe("buildMatrix", () => {
  test("groups tickets by tag and epic, synthetic rows last", () => {
    const m = buildMatrix({
      "TASK-A": entry({
        extid: "TASK-A",
        type: "TASK",
        tags: ["plan", "matrix"],
        epic: "auth",
        status: "done",
      }),
      "TASK-B": entry({ extid: "TASK-B", type: "TASK", tags: ["plan"], status: "In Progress" }),
      "TASK-C": entry({ extid: "TASK-C", type: "TASK", status: "Weird" }),
    });

    expect(m.total).toBe(3);
    expect(m.byTag.map((r) => r.key)).toEqual(["matrix", "plan", "(untagged)"]);
    const plan = m.byTag.find((r) => r.key === "plan")!;
    expect(plan.total).toBe(2);
    expect(plan.statuses).toEqual({
      done: 1,
      in_progress: 1,
      open: 0,
      draft: 0,
      cancelled: 0,
      other: 0,
    });
    expect(plan.tickets).toEqual(["TASK-A", "TASK-B"]);
    const untagged = m.byTag[m.byTag.length - 1]!;
    expect(untagged.key).toBe("(untagged)");
    expect(untagged.total).toBe(1);
    expect(untagged.statuses.other).toBe(1);

    expect(m.byEpic.map((r) => r.key)).toEqual(["auth", "(unbound)"]);
    expect(m.unbound).toBe(2);
    expect(m.untagged).toBe(1);
  });

  test("normalizes statuses into buckets without coercion", () => {
    const m = buildMatrix({
      A: entry({ extid: "A", status: "✅ Complete" }),
      B: entry({ extid: "B", status: "Weird (custom text)" }),
    });
    const row = m.byTag.find((r) => r.key === "(untagged)")!;
    expect(row.statuses.done).toBe(1);
    expect(row.statuses.other).toBe(1);
  });

  test("is deterministic regardless of input key order", () => {
    const a = buildMatrix({
      X: entry({ extid: "X", tags: ["t2"] }),
      Y: entry({ extid: "Y", tags: ["t1", "t2"] }),
    });
    const b = buildMatrix({
      Y: entry({ extid: "Y", tags: ["t1", "t2"] }),
      X: entry({ extid: "X", tags: ["t2"] }),
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(generateMatrixMarkdown(a)).toBe(generateMatrixMarkdown(b));
  });

  test("omits synthetic rows when nothing is untagged/unbound", () => {
    const m = buildMatrix({ X: entry({ extid: "X", tags: ["t"], epic: "e" }) });
    expect(m.byTag.map((r) => r.key)).toEqual(["t"]);
    expect(m.byEpic.map((r) => r.key)).toEqual(["e"]);
    expect(m.untagged).toBe(0);
    expect(m.unbound).toBe(0);
  });
});

describe("generateMatrixMarkdown", () => {
  test("empty index renders canonical bytes", () => {
    const expected = [
      "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->",
      "<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->",
      "",
      "<!-- Do not edit manually — regenerate with `giwt plan matrix` -->",
      "",
      "# Feature matrix",
      "",
      "Total tickets: **0** — untagged: **0** — unbound to epic: **0**",
      "",
      "## By tag × status",
      "",
      "| Tag | Total | done | in_progress | open | draft | cancelled | other |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      "",
      "## By epic × status",
      "",
      "| Epic | Total | done | in_progress | open | draft | cancelled | other |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      "",
      "## Ticket detail",
      "",
      "### By tag",
      "",
      "(none)",
      "",
      "### By epic",
      "",
      "(none)",
      "",
    ].join("\n");
    expect(generateMatrixMarkdown(buildMatrix({}))).toBe(expected);
  });

  test("has no timestamps — freshness is byte equality", () => {
    const m = buildMatrix({ A: entry({ extid: "A", tags: ["t"] }) });
    expect(generateMatrixMarkdown(m)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("co-occurrence section only when flagged", () => {
    const m = buildMatrix({
      A: entry({ extid: "A", tags: ["p", "q"] }),
      B: entry({ extid: "B", tags: ["p"] }),
    });
    const plain = generateMatrixMarkdown(m);
    expect(plain).not.toContain("## Tag co-occurrence");
    const withCo = generateMatrixMarkdown(m, { cooccurrence: true });
    expect(withCo).toContain("## Tag co-occurrence");
    expect(withCo).toContain("| p | q | 1 |");
  });
});

// ── matrix validate gate ────────────────────────────────────────

describe("matrix gate", () => {
  let root: string;
  let planDir: string;
  let indexPath: string;
  let outPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "giwt-matrix-gate-"));
    planDir = join(root, ".plan");
    indexPath = join(planDir, "tickets", "index.json");
    outPath = join(planDir, "feature-matrix.md");
    mkdirSync(join(planDir, "tickets"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function validate(fix = false) {
    return runValidate({
      projectRoot: root,
      worktreeRoot: root,
      ticketsDir: join(planDir, "tickets"),
      epicsDir: join(planDir, "epics"),
      backlogDir: join(planDir, "backlog"),
      planDir,
      srcDir: "src",
      codeMapPath: join(planDir, "code-map.json"),
      epicsIndexPath: join(planDir, "epics-index.md"),
      mapSources: [],
      linkScanDirs: [],
      backlogIndexFiles: [],
      gates: ["matrix"],
      runSync: () => 0,
      ...(fix ? { fix: true } : {}),
    });
  }

  function writeIndex(entries: Record<string, IndexEntry>): void {
    writeFileSync(indexPath, JSON.stringify(entries, null, 2));
  }

  test("registers in ALL_GATES (default-on, last)", () => {
    expect(ALL_GATES[ALL_GATES.length - 1]).toBe("matrix");
    expect(ALL_GATES).toContain("matrix");
  });

  test("missing index is an error naming the path", () => {
    const result = validate();
    expect(result.pass).toBe(false);
    expect(result.results[0]!.findings[0]!.message).toContain("ticket index missing");
  });

  test("corrupt index is an error, not a throw", () => {
    writeFileSync(indexPath, "{not json");
    const result = validate();
    expect(result.pass).toBe(false);
    expect(result.results[0]!.findings[0]!.message).toContain("invalid JSON");
  });

  test("missing matrix file fails, generated file passes", () => {
    writeIndex({ A: entry({ extid: "A", tags: ["t"] }) });
    expect(validate().pass).toBe(false);
    genMatrix(indexPath, outPath);
    expect(validate().pass).toBe(true);
  });

  test("tampered file is stale; --fix regenerates and re-checks", () => {
    writeIndex({ A: entry({ extid: "A" }) });
    genMatrix(indexPath, outPath);
    writeFileSync(outPath, readFileSync(outPath, "utf8") + "tampered\n");
    const stale = validate();
    expect(stale.pass).toBe(false);
    expect(stale.results[0]!.findings[0]!.message).toContain("stale");

    const fixed = validate(true);
    expect(fixed.pass).toBe(true);
    expect(fixed.results[0]!.fixes?.length).toBe(1);
    // The regenerated file is byte-identical to a fresh build.
    expect(readFileSync(outPath, "utf8")).toBe(matrixOutput(indexPath).output);
  });
});
