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
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      ]);
    } finally {
      cleanup(root);
    }
  });

  it("returns [] for an empty dir", () => {
    const root = makeRepo();
    try {
      expect(applicableChecks(root)).toEqual([]);
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

  it("maps stubbed tool output to findings", () => {
    const root = makeRepo();
    try {
      write(root, "eslint.config.js", "export default [];\n");
      write(root, "tsconfig.json", "{}\n");
      write(root, "package.json", JSON.stringify({ scripts: { test: "bun test" } }));
      write(root, "src/a.ts", "// TODO: stub me\n");
      const report: DoctorCheckReport = runDoctorChecks(
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

  it("skips non-applicable checks and honors the filter", () => {
    const root = makeRepo();
    try {
      const report = runDoctorChecks(root, { checks: ["lint", "todo"] });
      const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
      expect(byId["lint"]?.skipped).toBe("not applicable to this project");
      expect(byId["todo"]?.skipped).toBe("not applicable to this project");
      expect(checkExitCode(report)).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("warnings alone never fail", () => {
    const root = makeRepo();
    try {
      write(root, "biome.json", "{}\n");
      write(root, "src/a.ts", "export const x = 1;\n");
      const report = runDoctorChecks(
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

  it("check errors fail the report", () => {
    const root = makeRepo();
    try {
      write(root, "tsconfig.json", "{}\n");
      const report = runDoctorChecks(root, {
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

describe("todo precision", () => {
  it("skips markers outside comments and inside test files", () => {
    const root = makeRepo();
    try {
      write(
        root,
        "src/a.ts",
        "const m = x === \"FIXME\" ? \"FIXME\" : \"TODO\";\n// TODO: real work\n",
      );
      write(root, "src/a.test.ts", "// TODO: scaffold\n");
      write(root, "__tests__/b.ts", "// TODO: fixture\n");
      const report = runDoctorChecks(root, { checks: ["todo"] });
      const findings = report.checks[0]?.findings ?? [];
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe("real work");
      expect(findings[0]?.line).toBe(2);
    } finally {
      cleanup(root);
    }
  });
});
