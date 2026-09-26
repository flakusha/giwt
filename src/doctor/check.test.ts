// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for doctor health checks (`check.ts`).
 *
 * Coverage:
 *   - Parsers against live-verified tool output shapes
 *   - applicableChecks on fixture repos
 *   - runDoctorChecks end-to-end with stubbed spawning
 *   - checkExitCode error/warning semantics
 *   - runTodo on a real fixture tree
 *   - runScratchpad findings/notes/skip semantics + largestDirs
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SCRATCH_CONFIG,
  DEFAULT_SCRATCHPAD_THRESHOLDS,
  largestDirs,
} from "../utils/scratch.ts";
import {
  applicableChecks,
  checkExitCode,
  type DoctorCheckReport,
  parseBiomeOutput,
  parseEslintJson,
  parseJscpdReport,
  parseKnipIssues,
  parseOxlintJson,
  parseTestOutput,
  parseTscOutput,
  runDoctorChecks,
  runScratchpad,
} from "./check.ts";

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "giwt-check-"));
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("parsers", () => {
  it("parseEslintJson maps severity to error flag", () => {
    const out = parseEslintJson(
      JSON.stringify([
        {
          filePath: "/r/src/a.ts",
          messages: [{ ruleId: "no-debugger", severity: 2, message: "No.", line: 2 }],
        },
      ]),
      "/r",
    );
    expect(out).toEqual([
      { file: "src/a.ts", line: 2, rule: "no-debugger", message: "No.", error: true },
    ]);
    expect(parseEslintJson("", "/r")).toEqual([]);
    expect(() => parseEslintJson("nope", "/r")).toThrow();
  });

  it("parseBiomeOutput maps correctness rules to errors", () => {
    const raw = [
      "src/a.ts:3:7 lint/correctness/noUnusedVariables ━━━━━━━━━━",
      "",
      "  ! Unused variable.",
      "",
      "src/b.ts:1:1 lint/style/useConst ━━━━━━━━━━",
      "",
      "  ! Use const.",
    ].join("\n");
    const out = parseBiomeOutput(raw, "/r");
    expect(out).toHaveLength(2);
    expect(out[0]?.error).toBe(true);
    expect(out[1]?.error).toBe(false);
    expect(out[1]?.message).toBe("Use const.");
  });

  it("parseOxlintJson reads diagnostics with span lines", () => {
    const out = parseOxlintJson(
      JSON.stringify({
        diagnostics: [
          {
            message: "No debugger",
            code: "eslint(no-debugger)",
            severity: "error",
            filename: "/r/bad.ts",
            labels: [{ span: { line: 2, column: 1 } }],
          },
        ],
      }),
      "/r",
    );
    expect(out).toEqual([
      { file: "bad.ts", line: 2, rule: "eslint(no-debugger)", message: "No debugger", error: true },
    ]);
    expect(parseOxlintJson("", "/r")).toEqual([]);
    expect(() => parseOxlintJson("{}", "/r")).toThrow();
  });

  it("parseTscOutput reads file(line,col) error lines", () => {
    const out = parseTscOutput("src/a.ts(3,7): error TS2322: Bad.\nFound 1 error.\n", "/r");
    expect(out).toEqual([{ file: "src/a.ts", line: 3, code: "TS2322", message: "Bad." }]);
  });

  it("parseTestOutput reads bun, jest, pytest, and go failures", () => {
    const raw = [
      "(fail) suite > breaks [0.5ms]",
      "FAIL src/other.test.ts",
      "FAILED test_x.py::test_y - boom",
      "--- FAIL: TestThing (0.00s)",
    ].join("\n");
    expect(parseTestOutput(raw).map((f) => f.name)).toEqual([
      "suite > breaks",
      "src/other.test.ts",
      "test_x.py::test_y - boom",
      "TestThing",
    ]);
    expect(parseTestOutput("0 fail")).toEqual([]);
  });

  it("parseKnipIssues handles the issues array shape", () => {
    const out = parseKnipIssues({
      issues: [{ file: "src/a.ts", exports: [], files: [{ name: "src/a.ts" }] }],
    });
    expect(out).toEqual([{ kind: "file", file: "src/a.ts", name: "src/a.ts" }]);
  });

  it("parseJscpdReport reads duplications", () => {
    const out = parseJscpdReport({
      duplicates: [
        {
          firstFile: { name: "a.ts", startLoc: { line: 1 } },
          secondFile: { name: "b.ts", startLoc: { line: 10 } },
          lines: 6,
        },
      ],
    });
    expect(out).toEqual([{ a: "a.ts", lineA: 1, b: "b.ts", lineB: 10, lines: 6 }]);
    expect(() => parseJscpdReport({})).toThrow();
  });
});

describe("applicableChecks", () => {
  it("detects the full inventory on a configured repo", () => {
    const root = makeRepo();
    try {
      write(root, "eslint.config.js", "export default [];\n");
      write(root, "tsconfig.json", "{}\n");
      write(root, "package.json", JSON.stringify({ scripts: { test: "bun test" } }));
      write(root, "knip.json", "{}\n");
      write(root, ".jscpd.json", "{}\n");
      write(root, "src/a.ts", "export const x = 1;\n");
      expect(applicableChecks(root)).toEqual([
        "lint",
        "typecheck",
        "tests",
        "knip",
        "jscpd",
        "todo",
        "scratchpad",
      ]);
    } finally {
      cleanup(root);
    }
  });

  it("returns only scratchpad for an empty dir", () => {
    const root = makeRepo();
    try {
      // scratchpad is pure FS — applicable to every repo, empty or not.
      expect(applicableChecks(root)).toEqual(["scratchpad"]);
    } finally {
      cleanup(root);
    }
  });
});

describe("runDoctorChecks", () => {
  const stubSpawn = (stdoutByTool: Record<string, string>) => {
    return (cmd: string[], _cwd: string) => {
      const bin = cmd[0] ?? "";
      const key = bin.includes("eslint")
        ? "eslint"
        : bin.includes("oxlint")
        ? "oxlint"
        : bin.includes("biome")
        ? "biome"
        : bin.includes("tsc")
        ? "tsc"
        : bin.includes("knip")
        ? "knip"
        : "tests";
      return { exitCode: 0, stdout: stdoutByTool[key] ?? "", stderr: "" };
    };
  };

  it("maps stubbed tool output to findings", async () => {
    const root = makeRepo();
    try {
      write(root, "eslint.config.js", "export default [];\n");
      write(root, "tsconfig.json", "{}\n");
      write(root, "package.json", JSON.stringify({ scripts: { test: "bun test" } }));
      write(root, "src/a.ts", "// TODO: stub me\n");
      const report: DoctorCheckReport = await runDoctorChecks(
        root,
        {
          checks: ["lint", "typecheck", "tests", "todo"],
          spawn: stubSpawn({
            eslint: JSON.stringify([
              {
                filePath: join(root, "src", "a.ts"),
                messages: [{ ruleId: "x", severity: 2, message: "Bad.", line: 1 }],
              },
            ]),
            tsc: "src/a.ts(2,3): error TS2322: Bad.\n",
            tests: "(fail) suite > breaks\n",
          }),
        },
        "bun run test",
      );
      expect(report.version).toBe(1);
      expect(report.root).toBe(root);
      const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
      expect(byId["lint"]?.findings).toHaveLength(1);
      expect(byId["lint"]?.findings[0]?.severity).toBe("error");
      expect(byId["typecheck"]?.findings[0]?.rule).toBe("TS2322");
      expect(byId["tests"]?.findings[0]?.message).toBe("suite > breaks");
      expect(byId["todo"]?.findings[0]?.rule).toBe("TODO");
      expect(checkExitCode(report)).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it("skips non-applicable checks and honors the filter", async () => {
    const root = makeRepo();
    try {
      const report = await runDoctorChecks(root, { checks: ["lint", "todo"] });
      const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
      expect(byId["lint"]?.skipped).toBe("not applicable to this project");
      expect(byId["todo"]?.skipped).toBe("not applicable to this project");
      expect(checkExitCode(report)).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("warnings alone never fail", async () => {
    const root = makeRepo();
    try {
      write(root, "biome.json", "{}\n");
      write(root, "src/a.ts", "export const x = 1;\n");
      const report = await runDoctorChecks(
        root,
        {
          checks: ["lint"],
          spawn: stubSpawn({
            biome: "src/a.ts:1:1 lint/style/useConst ━━━\n\n  ! Use const.\n",
          }),
        },
      );
      expect(report.checks[0]?.findings[0]?.severity).toBe("warning");
      expect(checkExitCode(report)).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("check errors fail the report", async () => {
    const root = makeRepo();
    try {
      write(root, "tsconfig.json", "{}\n");
      const report = await runDoctorChecks(root, {
        checks: ["typecheck"],
        spawn: () => ({ exitCode: 2, stdout: "", stderr: "boom" }),
      });
      expect(report.checks[0]?.ok).toBe(false);
      expect(checkExitCode(report)).toBe(1);
    } finally {
      cleanup(root);
    }
  });
});

describe("runDoctorChecks concurrency", () => {
  const makeApplicableRepo = () => {
    const root = makeRepo();
    write(root, "eslint.config.js", "export default [];\n");
    write(root, "tsconfig.json", "{}\n");
    write(root, "package.json", JSON.stringify({ scripts: { test: "bun test" } }));
    write(root, "knip.json", "{}\n");
    write(root, ".jscpd.json", "{}\n");
    write(root, "src/a.ts", "export const x = 1;\n");
    return root;
  };

  it("bounds in-flight checks at jobs", async () => {
    const root = makeApplicableRepo();
    try {
      const state = { inFlight: 0, max: 0 };
      const report = await runDoctorChecks(root, {
        checks: ["lint", "typecheck", "tests", "knip", "jscpd"],
        jobs: 2,
        spawn: async () => {
          state.inFlight++;
          state.max = Math.max(state.max, state.inFlight);
          await new Promise((r) => setTimeout(r, 10));
          state.inFlight--;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });
      expect(report.checks).toHaveLength(5);
      expect(state.max).toBe(2);
    } finally {
      cleanup(root);
    }
  });

  it("defaults to 4 concurrent checks", async () => {
    const root = makeApplicableRepo();
    try {
      const state = { inFlight: 0, max: 0 };
      await runDoctorChecks(root, {
        checks: ["lint", "typecheck", "tests", "knip", "jscpd"],
        spawn: async () => {
          state.inFlight++;
          state.max = Math.max(state.max, state.inFlight);
          await new Promise((r) => setTimeout(r, 10));
          state.inFlight--;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });
      expect(state.max).toBe(4);
    } finally {
      cleanup(root);
    }
  });

  it("preserves requested check order regardless of completion", async () => {
    const root = makeApplicableRepo();
    try {
      const report = await runDoctorChecks(root, {
        checks: ["lint", "typecheck", "tests", "knip", "jscpd"],
        spawn: async (cmd) => {
          const bin = cmd[0] ?? "";
          const delay = bin.includes("eslint")
            ? 40
            : bin.includes("tsc")
            ? 30
            : bin.includes("knip")
            ? 20
            : 5;
          await new Promise((r) => setTimeout(r, delay));
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });
      expect(report.checks.map((c) => c.id)).toEqual([
        "lint",
        "typecheck",
        "tests",
        "knip",
        "jscpd",
      ]);
    } finally {
      cleanup(root);
    }
  });

  it("throws on invalid jobs", () => {
    const root = makeApplicableRepo();
    try {
      expect(() => runDoctorChecks(root, { checks: ["lint"], jobs: 0 })).toThrow(
        /jobs must be an integer >= 1/,
      );
      expect(() => runDoctorChecks(root, { checks: ["lint"], jobs: 1.5 })).toThrow(
        /jobs must be an integer >= 1/,
      );
    } finally {
      cleanup(root);
    }
  });
});

describe("todo precision", () => {
  it("skips markers outside comments and inside test files", async () => {
    const root = makeRepo();
    try {
      write(
        root,
        "src/a.ts",
        "const m = x === \"FIXME\" ? \"FIXME\" : \"TODO\";\n// TODO: real work\n// TODO\n// TODO: x\n",
      );
      write(root, "src/a.test.ts", "// TODO: scaffold\n");
      write(root, "__tests__/b.ts", "// TODO: fixture\n");
      const report = await runDoctorChecks(root, { checks: ["todo"] });
      const findings = report.checks[0]?.findings ?? [];
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe("real work");
      expect(findings[0]?.line).toBe(2);
    } finally {
      cleanup(root);
    }
  });

  it("orders FIXME before TODO, then by file and line", async () => {
    const root = makeRepo();
    try {
      write(root, "src/b.ts", "// FIXME: later file\n// TODO: second\n");
      write(root, "src/a.ts", "// TODO: first\n// FIXME: urgent\n// TODO: third\n");
      const report = await runDoctorChecks(root, { checks: ["todo"] });
      const findings = report.checks[0]?.findings ?? [];
      expect(findings.map((f) => `${f.rule} ${f.file}:${f.line}`)).toEqual([
        "FIXME src/a.ts:2",
        "FIXME src/b.ts:1",
        "TODO src/a.ts:1",
        "TODO src/a.ts:3",
        "TODO src/b.ts:2",
      ]);
    } finally {
      cleanup(root);
    }
  });
});

describe("scratchpad check", () => {
  const TINY = { warnMb: 0.001, errorMb: 0.002, orphanWarn: 100, oldestWarnDays: 30 };
  const DAY = 24 * 60 * 60 * 1000;

  it("under thresholds is ok with the numbers in notes", () => {
    const root = makeRepo();
    try {
      write(root, ".tmp/cov-a/f.txt", "x".repeat(40));
      const res = runScratchpad(
        join(root, ".tmp"),
        DEFAULT_SCRATCH_CONFIG,
        DEFAULT_SCRATCHPAD_THRESHOLDS,
      );
      expect(res.id).toBe("scratchpad");
      expect(res.tool).toBe("scratchpad");
      expect(res.ok).toBe(true);
      expect(res.skipped).toBeUndefined();
      expect(res.findings).toEqual([]);
      expect(res.notes?.[0]).toMatch(/^total /);
      expect(res.notes?.join("\n")).toContain("orphans: 0 *.tmp");
      expect(res.notes?.join("\n")).toContain("cov-a");
    } finally {
      cleanup(root);
    }
  });

  it("over errorMb reports an error finding that fails checkExitCode", () => {
    const root = makeRepo();
    try {
      write(root, ".tmp/big.bin", "x".repeat(4096)); // 0.0039 MB > 0.002
      const res = runScratchpad(join(root, ".tmp"), DEFAULT_SCRATCH_CONFIG, TINY);
      const size = res.findings.find((f) => f.rule === "scratchpad:size");
      expect(size?.severity).toBe("error");
      expect(size?.kind).toBe("bug");
      expect(size?.message).toContain("threshold");
      expect(checkExitCode({ version: 1, root, checks: [res] })).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it("between warnMb and errorMb is a warning only (exit 0)", () => {
    const root = makeRepo();
    try {
      write(root, ".tmp/med.bin", "x".repeat(4096));
      const res = runScratchpad(join(root, ".tmp"), DEFAULT_SCRATCH_CONFIG, {
        ...TINY,
        errorMb: 1,
      });
      expect(res.findings).toHaveLength(1);
      expect(res.findings[0]?.rule).toBe("scratchpad:size");
      expect(res.findings[0]?.severity).toBe("warning");
      expect(res.findings[0]?.kind).toBe("task");
      expect(checkExitCode({ version: 1, root, checks: [res] })).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("orphan *.tmp count over the limit is an error", () => {
    const root = makeRepo();
    try {
      write(root, ".tmp/a.tmp", "x");
      write(root, ".tmp/b.tmp", "x");
      write(root, ".tmp/c.tmp", "x");
      const res = runScratchpad(join(root, ".tmp"), DEFAULT_SCRATCH_CONFIG, {
        ...TINY,
        orphanWarn: 2,
      });
      const orphans = res.findings.find((f) => f.rule === "scratchpad:orphans");
      expect(orphans?.severity).toBe("error");
      expect(orphans?.message).toContain("3");
      expect(checkExitCode({ version: 1, root, checks: [res] })).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it("oldest artifact over oldestWarnDays is a warning", () => {
    const root = makeRepo();
    try {
      const now = 1_800_000_000_000;
      write(root, ".tmp/old.tmp", "x");
      const stale = new Date(now - 40 * DAY);
      utimesSync(join(root, ".tmp", "old.tmp"), stale, stale);
      const res = runScratchpad(
        join(root, ".tmp"),
        DEFAULT_SCRATCH_CONFIG,
        TINY,
        now,
      );
      const age = res.findings.find((f) => f.rule === "scratchpad:age");
      expect(age?.severity).toBe("warning");
      expect(age?.message).toContain("40.0 days");
      expect(res.notes?.join("\n")).toContain("40.0 days");
      expect(checkExitCode({ version: 1, root, checks: [res] })).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("missing scratch dir is a clean skip", () => {
    const root = makeRepo();
    try {
      const res = runScratchpad(
        join(root, "no-such-tmp"),
        DEFAULT_SCRATCH_CONFIG,
        DEFAULT_SCRATCHPAD_THRESHOLDS,
      );
      expect(res.ok).toBe(true);
      expect(res.skipped).toContain("no scratchpad dir at");
      expect(res.findings).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("largestDirs orders, caps, and tolerates a missing root", () => {
    const root = makeRepo();
    try {
      write(root, "a/f.txt", "xxx"); // 3 bytes
      write(root, "b/f.txt", "xxxxxxx"); // 7 bytes
      write(root, "c/deep/g.txt", "xx"); // 2 bytes, nested one level down
      write(root, "loose.txt", "x"); // a file is never a dir entry
      expect(largestDirs(root, 2)).toEqual([
        { path: join(root, "b"), bytes: 7 },
        { path: join(root, "a"), bytes: 3 },
      ]);
      expect(largestDirs(root, 0)).toEqual([]);
      expect(largestDirs(join(root, "missing"), 5)).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("runDoctorChecks wires opts.scratch and leaves other checks intact", async () => {
    const root = makeRepo();
    try {
      write(root, ".tmp/med.tmp", "y".repeat(2048)); // 0.00195 MB: warn, not error
      const report = await runDoctorChecks(root, {
        checks: ["todo", "scratchpad"],
        scratch: {
          config: DEFAULT_SCRATCH_CONFIG,
          thresholds: { ...TINY, errorMb: 1 },
          rootDir: ".tmp",
        },
      });
      expect(report.checks.map((c) => c.id)).toEqual(["todo", "scratchpad"]);
      const sp = report.checks[1];
      expect(sp?.tool).toBe("scratchpad");
      expect(sp?.findings.map((f) => f.rule)).toEqual(["scratchpad:size"]);
      expect(sp?.findings[0]?.severity).toBe("warning");
      expect(checkExitCode(report)).toBe(0);

      // Without opts.scratch the defaults apply (root/.tmp, 100/500 MB,
      // orphanWarn 100): the tiny fixture stays far under every threshold.
      const bare = await runDoctorChecks(root, { checks: ["scratchpad"] });
      expect(bare.checks[0]?.id).toBe("scratchpad");
      expect(bare.checks[0]?.findings).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});

describe("parser edge shapes", () => {
  it("parseTestOutput falls back to a failure-count summary", () => {
    expect(parseTestOutput("5 tests failed")).toEqual([
      { name: "5 failing (see test output)" },
    ]);
  });

  it("parseOxlintJson throws on unparseable output", () => {
    expect(() => parseOxlintJson("not json", "/r")).toThrow("unparseable");
  });

  it("parseKnipIssues reads the legacy keyed shape (no issues array)", () => {
    const out = parseKnipIssues({
      files: ["src/only-file.ts"],
      exports: [{ symbol: "unused", file: "src/a.ts", line: 4 }],
      dependencies: [{ name: "left-pad" }],
      devDependencies: [{ name: "tsx" }],
      unlisted: [{ specifier: "missing-pkg" }],
      unresolved: [{ name: "gone" }],
      types: ["SomeType"],
      binaries: "not-an-array",
    });
    expect(out).toEqual([
      { kind: "file", file: "", name: "src/only-file.ts" },
      { kind: "export", file: "", name: "unused", line: 4 },
      { kind: "dependency", file: "", name: "left-pad" },
      { kind: "dependency", file: "", name: "tsx" },
      { kind: "dependency", file: "", name: "missing-pkg" },
      { kind: "issue", file: "", name: "gone" },
      { kind: "issue", file: "", name: "SomeType" },
    ]);
  });
});

describe("runner failure and report paths", () => {
  it("runs oxlint and surfaces an unparseable report as a check error", async () => {
    const root = makeRepo();
    try {
      write(root, ".oxlintrc.json", "{}");
      write(root, "src/a.ts", "export const x = 1;\n");
      const report = await runDoctorChecks(root, {
        checks: ["lint"],
        spawn: () => ({ exitCode: 1, stdout: "not json", stderr: "boom" }),
      });
      const lint = report.checks[0]!;
      expect(lint.tool).toBe("oxlint");
      expect(lint.ok).toBe(false);
      expect(lint.error).toContain("oxlint failed");
      expect(checkExitCode(report)).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it("runs oxlint and maps diagnostics to findings", async () => {
    const root = makeRepo();
    try {
      write(root, ".oxlintrc.json", "{}");
      write(root, "src/a.ts", "export const x = 1;\n");
      const report = await runDoctorChecks(root, {
        checks: ["lint"],
        spawn: () => ({
          exitCode: 1,
          stdout: JSON.stringify({
            diagnostics: [
              {
                message: "No debugger",
                code: "eslint(no-debugger)",
                severity: "error",
                filename: join(root, "src", "a.ts"),
                labels: [{ span: { line: 1 } }],
              },
            ],
          }),
          stderr: "",
        }),
      });
      expect(report.checks[0]?.tool).toBe("oxlint");
      expect(report.checks[0]?.findings[0]?.rule).toBe("eslint(no-debugger)");
    } finally {
      cleanup(root);
    }
  });

  it("reports a failing test command with no parseable failures", async () => {
    const root = makeRepo();
    try {
      write(root, "package.json", JSON.stringify({ scripts: { test: "true" } }));
      const report = await runDoctorChecks(root, {
        checks: ["tests"],
        spawn: () => ({ exitCode: 3, stdout: "boom", stderr: "" }),
      });
      const tests = report.checks[0]!;
      expect(tests.ok).toBe(false);
      expect(tests.error).toContain("exited 3");
    } finally {
      cleanup(root);
    }
  });

  it("runs the test command through the real spawn when none is injected", async () => {
    const root = makeRepo();
    try {
      write(root, "package.json", JSON.stringify({ scripts: { test: "true" } }));
      const report = await runDoctorChecks(root, { checks: ["tests"] }, "true");
      expect(report.checks[0]?.ok).toBe(true);
      expect(report.checks[0]?.findings).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("surfaces a knip crash and maps knip issues to findings", async () => {
    const root = makeRepo();
    try {
      write(root, "knip.json", "{}");
      write(root, "src/a.ts", "export const x = 1;\n");
      const crashed = await runDoctorChecks(root, {
        checks: ["knip"],
        spawn: () => ({ exitCode: 2, stdout: "not json", stderr: "knip blew up" }),
      });
      expect(crashed.checks[0]?.ok).toBe(false);
      expect(crashed.checks[0]?.error).toContain("knip failed");

      const ok = await runDoctorChecks(root, {
        checks: ["knip"],
        spawn: () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            issues: [
              {
                file: "src/a.ts",
                files: [{ name: "src/a.ts", line: 3 }],
                exports: [{ symbol: "unused" }],
                dependencies: [{ name: "left-pad" }],
              },
              { file: "src/b.ts", types: ["SomeType"] },
            ],
          }),
          stderr: "",
        }),
      });
      const findings = ok.checks[0]?.findings ?? [];
      expect(findings.map((f) => f.rule)).toEqual([
        "knip:file",
        "knip:export",
        "knip:dependency",
        "knip:issue",
      ]);
      expect(findings[3]?.severity).toBe("error");
      expect(checkExitCode(ok)).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it("maps a jscpd report file to duplication findings", async () => {
    const root = makeRepo();
    try {
      write(root, ".jscpd.json", "{}");
      write(root, "src/a.ts", "export const x = 1;\n");
      const report = await runDoctorChecks(root, {
        checks: ["jscpd"],
        spawn: (cmd) => {
          const outDir = cmd[cmd.indexOf("-o") + 1]!;
          writeFileSync(
            join(outDir, "jscpd-report.json"),
            JSON.stringify({
              duplicates: [
                {
                  firstFile: { name: join(root, "src", "a.ts"), startLoc: { line: 4 } },
                  secondFile: { name: join(root, "src", "b.ts"), startLoc: { line: 30 } },
                  lines: 12,
                },
              ],
            }),
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });
      const jscpd = report.checks[0]!;
      expect(jscpd.ok).toBe(true);
      expect(jscpd.findings).toHaveLength(1);
      expect(jscpd.findings[0]?.file).toBe("src/a.ts");
      expect(jscpd.findings[0]?.line).toBe(4);
      expect(jscpd.findings[0]?.rule).toBe("duplication");
      expect(jscpd.findings[0]?.message).toContain("src/a.ts:4 ↔ src/b.ts:30");
    } finally {
      cleanup(root);
    }
  });
});
