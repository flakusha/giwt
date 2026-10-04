// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the `leaks` doctor check — test-file resource openers with no
 * teardown.
 *
 * Covers:
 *   - findLeaksInText: open/close pairing, afterAll/afterEach/t.cleanup
 *     registration, later-occurrence rule, conservativeness (unrelated
 *     vars, non-teardown usage)
 *   - scanLeaks: src-tree *.test.ts walk, rel paths, sorting
 *   - applicability: hasTestFiles + applicableChecks gating
 *   - runLeaks: CheckResult shape, warning/task severity, exit code
 *   - registration: CHECK_IDS + runDoctorChecks end-to-end
 *
 * Each test owns a private mkdtemp repo (unique per test, cleaned up in
 * finally), so the suite is parallel-safe with no shared fixtures.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import {
  applicableChecks,
  CHECK_IDS,
  CHECK_MAX_FINDINGS,
  checkExitCode,
  runDoctorChecks,
  runLeaks,
} from "./check.ts";
import { findLeaksInText, hasTestFiles, scanLeaks } from "./leaks.ts";
import type { LeakMatch } from "./leaks.ts";

function makeRepo(): string {
  return mkdtempSync(join(scratchRoot(), "giwt-leaks-"));
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Pure-text scan with a stable fixture path. */
function leaksOf(text: string): LeakMatch[] {
  return findLeaksInText(text, "src/a.test.ts");
}

describe("findLeaksInText", () => {
  it("flags a bare createTestDb opener", () => {
    expect(leaksOf("const db = createTestDb();\nexpect(db.count).toBe(1);\n")).toEqual([
      { file: "src/a.test.ts", line: 1, var: "db", opener: "createTestDb" },
    ]);
  });

  it("accepts a paired close/destroy as teardown", () => {
    expect(leaksOf("const db = createTestDb();\ndb.close();\n")).toEqual([]);
    expect(leaksOf("const db = createTestDb();\n db.destroy( );\n")).toEqual([]);
  });

  it("accepts Bun.spawn + kill, flags other finalization", () => {
    expect(leaksOf("const proc = Bun.spawn([\"sleep\", \"1\"]);\nproc.kill();\n")).toEqual([]);
    const res = leaksOf("const proc = Bun.spawn([\"sleep\", \"1\"]);\nawait proc.exited;\n");
    expect(res).toEqual([{ file: "src/a.test.ts", line: 1, var: "proc", opener: "Bun.spawn" }]);
  });

  it("requires the teardown to come after the declaration", () => {
    expect(leaksOf("db.close();\nconst db = createTestDb();\n")).toEqual([
      { file: "src/a.test.ts", line: 2, var: "db", opener: "createTestDb" },
    ]);
  });

  it("accepts teardown via afterAll/afterEach/t.cleanup registration", () => {
    expect(leaksOf("const db = createTestDb();\nafterAll(() => {\n  db.close();\n});\n"))
      .toEqual([]);
    // Registration without a paired method: the var mention inside the
    // afterAll block is enough.
    expect(leaksOf("const db = createTestDb();\nafterAll(() => {\n  teardownDb(db);\n});\n"))
      .toEqual([]);
    expect(leaksOf("const db = createTestDb();\nafterEach(() => resetDb(db));\n")).toEqual([]);
    expect(leaksOf(
      "test(\"x\", (t) => {\n  const db = createTestDb();\n  t.cleanup(() => db.close());\n});\n",
    )).toEqual([]);
  });

  it("ignores teardown calls on a differently-named variable", () => {
    const res = leaksOf("const db = createTestDb();\ndb2.close();\n");
    expect(res).toHaveLength(1);
    expect(res[0]?.var).toBe("db");
  });

  it("does not treat arbitrary var usage as teardown", () => {
    expect(leaksOf("const db = createTestDb();\nexpect(db.rows).toHaveLength(0);\n"))
      .toHaveLength(1);
  });

  it("reads await and type-annotated declarations", () => {
    expect(leaksOf("const db: TestDb = await createTestDb();\ndb.close();\n")).toEqual([]);
    expect(leaksOf("const db: TestDb = await createTestDb();\n")).toHaveLength(1);
  });

  it("reports 1-based line numbers", () => {
    const res = leaksOf("// setup\n// more setup\nconst db = createTestDb();\n");
    expect(res[0]?.line).toBe(3);
  });
});

describe("scanLeaks", () => {
  it("walks src/**/*.test.ts with root-relative sorted output", () => {
    const root = makeRepo();
    try {
      write(root, "src/nested/deep.test.ts", "const p = Bun.spawn([\"x\"]);\n");
      write(root, "src/a.test.ts", "// line1\nconst db = createTestDb();\n");
      // Not scan targets: non-test source and tests outside src/.
      write(root, "src/plain.ts", "const db = createTestDb();\n");
      write(root, "b.test.ts", "const db = createTestDb();\n");
      expect(scanLeaks(root)).toEqual([
        { file: "src/a.test.ts", line: 2, var: "db", opener: "createTestDb" },
        { file: "src/nested/deep.test.ts", line: 1, var: "p", opener: "Bun.spawn" },
      ]);
    } finally {
      cleanup(root);
    }
  });

  it("returns [] when src/ is missing", () => {
    const root = makeRepo();
    try {
      expect(scanLeaks(root)).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});

describe("leaks applicability", () => {
  it("is inapplicable without test files", () => {
    const root = makeRepo();
    try {
      expect(hasTestFiles(root)).toBe(false);
      expect(applicableChecks(root)).toEqual(["scratchpad"]);
    } finally {
      cleanup(root);
    }
  });

  it("applies once a src test file exists", () => {
    const root = makeRepo();
    try {
      write(root, "src/a.test.ts", "export const x = 1;\n");
      expect(hasTestFiles(root)).toBe(true);
      expect(applicableChecks(root)).toContain("leaks");
    } finally {
      cleanup(root);
    }
  });
});

describe("runLeaks", () => {
  it("maps findings to warning/task CheckFindings and never fails", () => {
    const root = makeRepo();
    try {
      write(root, "src/a.test.ts", "const db = createTestDb();\n");
      const res = runLeaks(root);
      expect(res.id).toBe("leaks");
      expect(res.tool).toBe("leak-scan");
      expect(res.ok).toBe(true);
      expect(res.skipped).toBeUndefined();
      expect(res.error).toBeUndefined();
      expect(res.findings).toHaveLength(1);
      const f = res.findings[0];
      expect(f?.file).toBe("src/a.test.ts");
      expect(f?.line).toBe(1);
      expect(f?.rule).toBe("leaks:createTestDb");
      expect(f?.severity).toBe("warning");
      expect(f?.kind).toBe("task");
      expect(f?.message).toContain("createTestDb");
      expect(f?.message).toContain("'db'");
      expect(f?.message).toContain("db.close()");
      // Warnings alone never flip the exit code (todo precedent).
      expect(checkExitCode({ version: 1, root, checks: [res] })).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("caps findings at CHECK_MAX_FINDINGS", () => {
    const root = makeRepo();
    try {
      for (let i = 0; i < CHECK_MAX_FINDINGS + 5; i++) {
        write(root, `src/f${i}.test.ts`, "const db = createTestDb();\n");
      }
      expect(runLeaks(root).findings).toHaveLength(CHECK_MAX_FINDINGS);
    } finally {
      cleanup(root);
    }
  });
});

describe("leaks registration", () => {
  it("is a selectable check id", () => {
    expect(CHECK_IDS).toContain("leaks");
  });

  it("runs through runDoctorChecks", async () => {
    const root = makeRepo();
    try {
      write(root, "src/a.test.ts", "const db = createTestDb();\n");
      const report = await runDoctorChecks(root, { checks: ["leaks"] });
      expect(report.checks).toHaveLength(1);
      const check = report.checks[0];
      expect(check?.id).toBe("leaks");
      expect(check?.ok).toBe(true);
      expect(check?.findings).toHaveLength(1);
      expect(check?.findings[0]?.rule).toBe("leaks:createTestDb");
      expect(checkExitCode(report)).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("is skipped, not failed, on repos without test files", async () => {
    const root = makeRepo();
    try {
      const report = await runDoctorChecks(root, { checks: ["leaks"] });
      expect(report.checks[0]?.skipped).toBe("not applicable to this project");
      expect(report.checks[0]?.findings).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});
