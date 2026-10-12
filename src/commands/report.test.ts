// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "../utils/scratch-tmp";
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the report command: renders one row per worktree from its check
 * report, degrades gracefully for missing and malformed reports, and skips
 * the worktree sweep entirely when no tree/ exists.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { setOutputFormat } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { report } from "./report";

let root: string;
let treeDir: string;
let config: WorktreeConfig;

function captureOutput(): { lines: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    lines: () => chunks.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

function reportJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    branch: "feat/a",
    gitHead: "abc1234",
    runId: "run-1",
    mode: "full",
    gates: { lint: { status: "passed" }, test: { status: "failed" }, gen: { status: "skipped" } },
    passed: true,
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  });
}

beforeEach(() => {
  // Report output uses ANSI color codes that depend on the runtime
  // environment (NO_COLOR / CI / OMP). Bun's test runner does not set
  // any of those, so the raw output contains the escape codes. Disable
  // colors for the test process so the assertions match the plain-text
  // labels the report command actually prints (e.g. `(main) no report`).
  process.env.NO_COLOR = "1";
  setOutputFormat("simple");
  root = mkdtempSync(join(scratchRoot(), "giwt-report-test-"));
  mkdirSync(join(root, ".tmp"), { recursive: true });
  treeDir = resolve(root, "tree");
  mkdirSync(treeDir);
  config = { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("report", () => {
  test("prints no-report rows and stops when tree/ is absent", async () => {
    rmSync(treeDir, { recursive: true, force: true });
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("Check reports across worktrees");
    expect(out).toContain("(main) no report");
    expect(out).toContain("No tree/ directory found");
  });

  test("renders the main report with per-gate statuses", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), reportJson());
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("(main) PASSED");
    expect(out).toContain("feat/a @ abc1234");
    expect(out).toContain("run: run-1 | mode: full");
    expect(out).toContain("lint: passed");
    expect(out).toContain("test: failed");
    expect(out).toContain("gen: skipped");
  });

  test("renders FAILED for a report that did not pass and ? for unknown statuses", async () => {
    writeFileSync(
      join(root, DEFAULT_SETTINGS.paths.checkReport),
      reportJson({ passed: false, gates: { mystery: { status: "weird" } } }),
    );
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("(main) FAILED");
    expect(out).toContain("mystery: ? weird");
  });

  test("flags a malformed main report instead of aborting", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), "{not json");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("(main) malformed report");
  });

  test("rejects non-object and gateless payloads as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), "42");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("report root is not a JSON object");
  });

  test("rejects an array root as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), "[]");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("report root is not a JSON object");
  });

  test("rejects a missing gates section as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), JSON.stringify({ branch: "x" }));
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("missing or invalid 'gates' section");
  });

  test("rejects a non-object gates section as malformed", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), JSON.stringify({ gates: [] }));
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("missing or invalid 'gates' section");
  });

  test("renders a mixed set of worktree rows", async () => {
    writeFileSync(join(root, DEFAULT_SETTINGS.paths.checkReport), reportJson());
    mkdirSync(resolve(treeDir, "good"));
    mkdirSync(resolve(treeDir, "good", ".tmp"), { recursive: true });
    writeFileSync(resolve(treeDir, "good", DEFAULT_SETTINGS.paths.checkReport), reportJson());
    mkdirSync(resolve(treeDir, "noreport"));
    mkdirSync(resolve(treeDir, "bad", ".tmp"), { recursive: true });
    writeFileSync(resolve(treeDir, "bad", DEFAULT_SETTINGS.paths.checkReport), "nope");
    const cap = captureOutput();
    try {
      await report([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("good PASSED");
    expect(out).toContain("noreport no report");
    expect(out).toContain("bad malformed report");
  });
});

interface V2Check {
  command: string;
  passed?: boolean;
  skipped?: boolean;
  advisory?: boolean;
  timedOut?: boolean;
  durationMs?: number;
}

/** The exact shape loop-lore's `scripts/check/parallel/report.mjs`
 *  buildReport() writes: schemaVersion 2, `checks[]` with command/passed/
 *  skipped/advisory/timedOut/durationMs, `generatedAt`, and NO `gates` map.
 *  Fixture, never a live run — this is the shape that used to render as
 *  "malformed report" for every worktree. */
function v2ReportJson(
  checks: V2Check[],
  {
    generatedAt = "2026-10-10T13:14:37.612Z",
    runId = "75325-mv2eyoyu",
  }: { generatedAt?: string; runId?: string; } = {},
): string {
  const rows = checks.map((c) => ({
    command: c.command,
    passed: c.passed === true,
    skipped: c.skipped === true,
    advisory: c.advisory === true,
    timedOut: c.timedOut === true,
    exitCode: c.passed === true ? 0 : 1,
    durationMs: c.durationMs ?? 0,
    output: c.passed === true ? null : "gate failed\n",
    truncated: false,
  }));
  return JSON.stringify({
    schemaVersion: 2,
    generatedAt,
    runner: "bun run scripts/check-parallel.mjs",
    cwd: "/home/flak/git-ai/loop-lore",
    runId,
    mode: "plain",
    worktreeName: "loop-lore",
    branch: "dev",
    gitHead: "56fce2f30",
    gitDirty: false,
    gpgPrecheck: null,
    passed: rows.every((r) => r.passed || r.skipped || r.advisory),
    exitCode: 0,
    reportPath: ".tmp/check-report.json",
    summary: {
      total: rows.length,
      passed: rows.filter((r) => r.passed).length,
      skipped: rows.filter((r) => r.skipped).length,
      advisory: rows.filter((r) => r.advisory && !r.passed).length,
      failed: rows.filter((r) => !r.passed && !r.skipped && !r.advisory).length,
      durationMs: rows.reduce((sum, r) => sum + r.durationMs, 0),
    },
    checks: rows,
    nonBlocking: [],
  });
}

/** Write a report for one worktree ("(main)" targets the repo root). */
function writeWorktreeReport(name: string, json: string): void {
  const dir = name === "(main)" ? root : resolve(treeDir, name);
  mkdirSync(join(dir, ".tmp"), { recursive: true });
  writeFileSync(join(dir, DEFAULT_SETTINGS.paths.checkReport), json);
}

/** Write a per-run archive file into one worktree's scratchpad (the files the
 *  runner leaves behind: `.tmp/check-report-<runId>.json` and the rolling
 *  `.tmp/check-report.json` / `.tmp/check-report.latest.json` aliases). */
function writeArchive(name: string, file: string, json: string): void {
  const dir = name === "(main)" ? root : resolve(treeDir, name);
  mkdirSync(join(dir, ".tmp"), { recursive: true });
  writeFileSync(join(dir, ".tmp", file), json);
}

async function runReport(args: string[]): Promise<string> {
  const cap = captureOutput();
  try {
    await report(args, config);
  } finally {
    cap.restore();
  }
  return cap.lines();
}

describe("report — schemaVersion 2 (checks[])", () => {
  test("renders a v2 report instead of calling it malformed", async () => {
    writeWorktreeReport(
      "(main)",
      v2ReportJson([{ command: "bun run lint", passed: true, durationMs: 1200 }]),
    );
    const out = await runReport([]);
    expect(out).not.toContain("malformed report");
    expect(out).toContain("(main) PASSED — dev @ 56fce2f30");
    expect(out).toContain("run: 75325-mv2eyoyu | mode: plain | 2026-10-10T13:14:37.612Z");
    expect(out).toContain("bun run lint: passed");
  });

  test("renders skipped, advisory and timedOut distinctly, not as pass/fail", async () => {
    writeWorktreeReport(
      "(main)",
      v2ReportJson([
        { command: "ADVISORY: bun run jscpd", passed: false, advisory: true, durationMs: 900 },
        { command: "bun run coverage", skipped: true, durationMs: 0 },
        { command: "bun run test:unit", passed: false, timedOut: true, durationMs: 120000 },
        { command: "bun run lint", passed: true, durationMs: 800 },
      ]),
    );
    const out = await runReport([]);
    expect(out).toContain("bun run lint: passed");
    expect(out).toContain("ADVISORY: bun run jscpd: advisory");
    expect(out).toContain("bun run coverage: skipped");
    expect(out).toContain("bun run test:unit: timedOut");
    // None of the three may collapse into a red gate or a pass.
    expect(out).not.toContain("coverage: failed");
    expect(out).not.toContain("jscpd: failed");
    expect(out).toContain("(main) FAILED");
  });

  test("a worktree whose v2 report failed shows FAILED with its failing gate", async () => {
    writeWorktreeReport(
      "wt-b",
      v2ReportJson([
        { command: "bun run lint", passed: true, durationMs: 500 },
        { command: "bun run test:unit", passed: false, durationMs: 40000 },
      ]),
    );
    const out = await runReport([]);
    expect(out).not.toContain("wt-b malformed report");
    expect(out).toContain("wt-b FAILED — dev @ 56fce2f30");
    expect(out).toContain("bun run test:unit: failed");
  });

  test("still accepts the legacy gates map unchanged", async () => {
    writeWorktreeReport("(main)", reportJson());
    const out = await runReport([]);
    expect(out).not.toContain("malformed report");
    expect(out).toContain("(main) PASSED — feat/a @ abc1234");
    expect(out).toContain("run: run-1 | mode: full | 2026-01-01T00:00:00Z");
    expect(out).toContain("lint: passed");
    expect(out).toContain("test: failed");
    expect(out).toContain("gen: skipped");
  });

  test("rejects a non-array checks section as malformed", async () => {
    writeWorktreeReport("(main)", JSON.stringify({ schemaVersion: 2, checks: { lint: {} } }));
    expect(await runReport([])).toContain("missing or invalid 'checks' array");
  });

  test("rejects an unnamed check entry rather than dropping the gate", async () => {
    writeWorktreeReport(
      "(main)",
      JSON.stringify({
        schemaVersion: 2,
        checks: [{ command: "bun run lint", passed: true }, { passed: false }],
      }),
    );
    expect(await runReport([])).toContain("checks[1] has no 'command' name");
  });
});

describe("report --profile", () => {
  test("groups failing gates by distinct runs, most-failing first", async () => {
    writeWorktreeReport(
      "(main)",
      v2ReportJson([
        { command: "bun run test:unit", passed: false, durationMs: 30000 },
        { command: "bun run lint", passed: true, durationMs: 1000 },
      ], { runId: "r-main" }),
    );
    writeWorktreeReport(
      "wt-a",
      v2ReportJson([
        { command: "bun run test:unit", passed: false, durationMs: 10000 },
        { command: "bun run lint", passed: true, durationMs: 1200 },
      ], { runId: "r-a" }),
    );
    writeWorktreeReport(
      "wt-b",
      v2ReportJson([
        { command: "bun run test:unit", passed: false, durationMs: 20000 },
      ], { runId: "r-b" }),
    );
    writeWorktreeReport(
      "wt-c",
      v2ReportJson([
        { command: "bun run lint", passed: false, durationMs: 900 },
      ], { runId: "r-c" }),
    );

    const lines = (await runReport(["--profile"])).split("\n");
    const unitIdx = lines.findIndex((l) => l.includes("bun run test:unit"));
    const lintIdx = lines.findIndex((l) => l.includes("bun run lint"));
    expect(lines[unitIdx]).toContain("3 run(s)");
    expect(lines[lintIdx]).toContain("1 run(s)");
    expect(unitIdx).toBeLessThan(lintIdx); // sorted by distinct failing runs desc
    // durations across the three runs: 10s, 20s, 30s
    expect(lines[unitIdx]).toContain("fail 3");
    expect(lines[unitIdx]).toContain("median 20.0s");
    expect(lines[unitIdx]).toContain("p90 30.0s");
    expect(lines[unitIdx]).toContain("max 30.0s");
  });

  test("counts advisory and timeout outcomes without ranking advisory as red", async () => {
    writeWorktreeReport(
      "(main)",
      v2ReportJson([
        { command: "bun run test:unit", passed: false, timedOut: true, durationMs: 120000 },
        { command: "ADVISORY: jscpd", passed: false, advisory: true, durationMs: 800 },
        { command: "bun run e2e", skipped: true, durationMs: 0 },
      ]),
    );
    const lines = (await runReport(["--profile"])).split("\n");
    const timeoutLine = lines.find((l) => l.includes("bun run test:unit"))!;
    expect(timeoutLine).toContain("1 run(s)");
    expect(timeoutLine).toContain("fail 0  timeout 1");
    expect(timeoutLine).toContain("median 120.0s");
    // an advisory failure never blocked a run, so it is not ranked
    expect(lines.some((l) => l.includes("ADVISORY: jscpd") && l.includes("run(s)"))).toBe(false);
    expect(lines.join("\n")).toContain("2 other gate(s) never failed");
  });

  test("--since drops older reports but keeps undated ones", async () => {
    writeWorktreeReport(
      "(main)",
      v2ReportJson([
        { command: "bun run old", passed: false, durationMs: 5000 },
      ], { generatedAt: "2026-01-01T00:00:00Z", runId: "r-old" }),
    );
    writeWorktreeReport(
      "wt-new",
      v2ReportJson([
        { command: "bun run fresh", passed: false, durationMs: 7000 },
      ], { generatedAt: "2026-10-10T00:00:00Z", runId: "r-new" }),
    );
    writeWorktreeReport(
      "wt-undated",
      v2ReportJson([
        { command: "bun run undated", passed: false, durationMs: 3000 },
      ], { generatedAt: "not-a-date", runId: "r-undated" }),
    );

    const out = await runReport(["--profile", "--since", "2026-10-01T00:00:00Z"]);
    expect(out).toContain("since 2026-10-01T00:00:00Z");
    expect(out).toContain("2 report(s)");
    expect(out).toContain("bun run fresh");
    expect(out).toContain("bun run undated");
    expect(out).not.toContain("bun run old");
    expect(out).toContain("1 report(s) carried no parseable timestamp and were kept");
  });

  test("profiles the legacy gates map too (no durations recorded)", async () => {
    writeWorktreeReport("(main)", reportJson());
    const out = await runReport(["--profile"]);
    expect(out).toContain("1 run(s) test — fail 1  timeout 0  advisory 0  skipped 0  passed 0");
    expect(out).not.toContain("median");
  });

  test("--json emits the ranking with durations", async () => {
    writeWorktreeReport(
      "(main)",
      v2ReportJson([
        { command: "bun run test:unit", passed: false, durationMs: 30000 },
        { command: "bun run lint", passed: true, durationMs: 1000 },
      ], { runId: "r-main" }),
    );
    writeWorktreeReport(
      "wt-a",
      v2ReportJson([
        { command: "bun run test:unit", passed: false, durationMs: 10000 },
      ], { runId: "r-a" }),
    );
    const payload = JSON.parse(await runReport(["--profile", "--json"]));
    expect(payload.reports).toBe(2);
    expect(payload.gates).toHaveLength(1);
    expect(payload.gates[0]).toMatchObject({
      gate: "bun run test:unit",
      runs: 2,
      failingRuns: 2,
      failures: 2,
      // nearest-rank quantile over [10000, 30000]: p50 lands on the lower sample
      medianMs: 10000,
      p90Ms: 30000,
      maxMs: 30000,
    });
    expect(payload.cleanGates).toBe(1);
  });

  test("reports no failing gates when every report is green", async () => {
    writeWorktreeReport("(main)", v2ReportJson([{ command: "bun run lint", passed: true }]));
    expect(await runReport(["--profile"])).toContain("no failing gates");
  });

  test("--json without --profile warns and still lists rows", async () => {
    writeWorktreeReport("(main)", v2ReportJson([{ command: "bun run lint", passed: true }]));
    const out = await runReport(["--json"]);
    expect(out).toContain("output flags apply to --profile only");
    expect(out).toContain("(main) PASSED");
  });

  test("profiles every per-run report in the scratchpad, not just the latest", async () => {
    writeWorktreeReport(
      "(main)",
      v2ReportJson([{ command: "bun run lint", passed: false }], { runId: "run-new" }),
    );
    writeArchive(
      "(main)",
      "check-report-111-old.json",
      v2ReportJson([{ command: "bun run older", passed: false }], {
        generatedAt: "2026-10-09T09:00:00.000Z",
        runId: "run-old",
      }),
    );
    writeWorktreeReport(
      "wt-a",
      v2ReportJson([{ command: "bun run lint", passed: false }], { runId: "run-wt" }),
    );

    const out = await runReport(["--profile"]);

    expect(out).toContain("3 report(s)");
    expect(out).toContain("2 run(s) bun run lint — fail 2");
    expect(out).toContain("1 run(s) bun run older — fail 1");
  });

  test("the rolling aliases of one run count as a single run", async () => {
    const latest = v2ReportJson([{ command: "bun run lint", passed: false }], { runId: "run-1" });
    writeWorktreeReport("(main)", latest);
    writeArchive("(main)", "check-report.latest.json", latest);
    writeArchive("(main)", "check-report-1-abc.json", latest);

    const out = await runReport(["--profile"]);

    expect(out).toContain("1 report(s)");
    expect(out).toContain("1 run(s) bun run lint — fail 1");
  });

  test("skips a broken archive file and a stray file in tree/", async () => {
    writeWorktreeReport("(main)", v2ReportJson([{ command: "bun run lint", passed: false }]));
    writeArchive("(main)", "check-report-broken.json", "{not json");
    writeArchive(
      "(main)",
      "unrelated.json",
      v2ReportJson([{ command: "not a gate", passed: false }]),
    );
    writeFileSync(resolve(treeDir, "stray-file"), "not a worktree");

    const out = await runReport(["--profile"]);

    expect(out).toContain("1 report(s)");
    expect(out).toContain("1 run(s) bun run lint — fail 1");
  });

  test("a bad --since and an unknown flag exit 1 with usage", async () => {
    const original = process.exit;
    const codes: number[] = [];
    /** Capture output across the throw: runReport only returns on success. */
    const attempt = async (args: string[]): Promise<string> => {
      const cap = captureOutput();
      let lines = "";
      try {
        await report(args, config);
        lines = cap.lines();
      } catch (err) {
        expect((err as Error).message).toBe("__exit:1");
        lines = cap.lines();
      } finally {
        cap.restore();
        process.exit = original;
      }
      return lines;
    };
    process.exit = ((code?: number) => {
      codes.push(code ?? 0);
      throw new Error(`__exit:${code}`);
    }) as never;
    const badSince = await attempt(["--since", "not-a-date"]);
    expect(codes).toEqual([1]);
    expect(badSince).toContain("--since needs an ISO timestamp");

    process.exit = ((code?: number) => {
      codes.push(code ?? 0);
      throw new Error(`__exit:${code}`);
    }) as never;
    const unknown = await attempt(["--frobnicate"]);
    expect(codes).toEqual([1, 1]);
    expect(unknown).toContain("unknown flag '--frobnicate'");
  });

  test("--help prints usage", async () => {
    expect(await runReport(["--help"])).toContain("--profile");
  });
});
