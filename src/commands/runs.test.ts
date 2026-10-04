// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "../utils/scratch-tmp";
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the `giwt runs` machine output flags (--json/--toml/--emoji)
 * over a synthetic runlog. Human rendering is covered by runlog.test.ts's
 * listRuns coverage and the outcome formatter tests.
 *
 * Resource contract (parallel-safe): each test owns a mkdtemp root with a
 * seeded runs dir, torn down in afterEach; the CLI runs as a subprocess
 * (`bun src/cli.ts runs …` with REPO_ROOT pinned to the fixture), so the
 * runs command module never loads in the coverage process.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "cli.ts");

let root: string;

function seedRun(name: string, meta: Record<string, unknown>): void {
  const dir = join(root, ".tmp", "giwt", "runs", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
}

function runCli(
  args: string[],
): { stdout: string; stderr: string; exitCode: number; } {
  const result = Bun.spawnSync(["bun", CLI, "runs", ...args], {
    cwd: root,
    env: { ...process.env, REPO_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? -1,
  };
}

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runs: machine output flags", () => {
  test("--json parses back to run records (compact)", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedRun("2026-01-01T00-00-00", {
      v: 1,
      cmd: "test",
      args: [],
      said: null,
      pid: 1,
      repoRoot: root,
      branch: "main",
      start: "2026-01-01T00:00:00Z",
      end: "2026-01-01T00:00:05Z",
      exitCode: 0,
    });
    const result = runCli(["--json"]);
    expect(result.exitCode).toBe(0);
    const records = JSON.parse(result.stdout) as Array<{
      cmd: string;
      exitCode: number;
      start: string;
      end: string;
      events: unknown[];
    }>;
    expect(records).toHaveLength(1);
    expect(records[0]!.cmd).toBe("test");
    expect(records[0]!.exitCode).toBe(0);
    expect(records[0]!.events).toEqual([]);
  });

  test("--toml round-trips via Bun.TOML.parse", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedRun("2026-01-02T00-00-00", {
      v: 1,
      cmd: "sync",
      args: [],
      said: null,
      pid: 1,
      repoRoot: root,
      branch: "main",
      start: "2026-01-02T00:00:00Z",
      exitCode: 1,
    });
    const result = runCli(["--toml"]);
    expect(result.exitCode).toBe(0);
    const parsed = Bun.TOML.parse(result.stdout) as {
      items: Array<{ cmd: string; exitCode: number; }>;
    };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.cmd).toBe("sync");
    expect(parsed.items[0]!.exitCode).toBe(1);
  });

  test("--emoji prints one ✅/❌ line per run", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedRun("2026-01-03T00-00-00", {
      v: 1,
      cmd: "ok-run",
      args: [],
      said: null,
      pid: 1,
      repoRoot: root,
      branch: "main",
      start: "2026-01-03T00:00:00Z",
      end: "2026-01-03T00:00:02Z",
      exitCode: 0,
    });
    seedRun("2026-01-04T00-00-00", {
      v: 1,
      cmd: "bad-run",
      args: [],
      said: null,
      pid: 1,
      repoRoot: root,
      branch: "main",
      start: "2026-01-04T00:00:00Z",
      end: "2026-01-04T00:00:03Z",
      exitCode: 2,
    });
    const result = runCli(["--emoji"]);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.startsWith("✅ ok-run"))).toBe(true);
    expect(lines.some((l) => l.startsWith("❌ bad-run"))).toBe(true);
    expect(lines.find((l) => l.startsWith("✅"))).toContain("ms");
  });
});

/** bun-test capture shapes used by the triage/diff fixtures. */
const FAIL_LOG_A = [
  "src/a.test.ts:",
  "(fail) alpha keeps failing [1.00ms]",
  "error: 1 !== 2",
  "",
  "src/b.test.ts:",
  "(fail) beta flaky [2.00ms]",
  "error: boom",
  "      at /r/src/b.test.ts:9:5",
  "",
  " 1 passes",
  " 2 fails",
].join("\n");

const FAIL_LOG_B = [
  "src/b.test.ts:",
  "(fail) beta flaky [2.00ms]",
  "error: boom",
  "      at /r/src/b.test.ts:9:5",
  "",
  "src/c.test.ts:",
  "(fail) gamma new [3.00ms]",
  "error: arrived",
  "",
  " 2 fails",
].join("\n");

const CLEAN_LOG = [
  "src/ok.test.ts:",
  "✓ passes [0.01ms]",
  "",
  " 1 passes",
].join("\n");

/** Seed a run dir whose test.log holds a captured bun-test output. */
function seedFailRun(name: string, capture: string): string {
  seedRun(name, {
    v: 1,
    cmd: "test",
    args: [],
    said: null,
    pid: 1,
    repoRoot: root,
    branch: "main",
    start: "2026-01-05T00:00:00Z",
    exitCode: 1,
  });
  const dir = join(root, ".tmp", "giwt", "runs", name);
  writeFileSync(join(dir, "test.log"), capture);
  return dir;
}

describe("runs triage", () => {
  test("--json extracts failing blocks with context lines", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("triage-me-111", FAIL_LOG_A);
    const result = runCli(["triage", "triage-me", "--json"]);
    expect(result.exitCode).toBe(0);
    const records = JSON.parse(result.stdout) as Array<{
      test: string;
      file?: string;
      "context-lines": string[];
    }>;
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      test: "alpha keeps failing",
      file: "src/a.test.ts",
      // Blank line after the error line ends the captured context.
      "context-lines": ["error: 1 !== 2"],
    });
    expect(records[1]!.test).toBe("beta flaky");
    expect(records[1]!.file).toBe("src/b.test.ts");
    expect(records[1]!["context-lines"]).toEqual([
      "error: boom",
      "      at /r/src/b.test.ts:9:5",
    ]);
  });

  test("--toml round-trips triage records via Bun.TOML.parse", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("triage-me-222", FAIL_LOG_A);
    const result = runCli(["triage", "triage-me", "--toml"]);
    expect(result.exitCode).toBe(0);
    const parsed = Bun.TOML.parse(result.stdout) as {
      items: Array<{ test: string; file: string; "context-lines": string[]; }>;
    };
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]!.test).toBe("alpha keeps failing");
    expect(parsed.items[1]!["context-lines"]).toContain("error: boom");
  });

  test("--emoji prints one ❌ line per failure", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("triage-me-333", FAIL_LOG_A);
    const result = runCli(["triage", "triage-me", "--emoji"]);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("❌ alpha keeps failing (src/a.test.ts)");
    expect(lines[1]).toBe("❌ beta flaky (src/b.test.ts)");
  });

  test("human output groups failures by file with context", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("triage-me-444", FAIL_LOG_A);
    const result = runCli(["triage", "triage-me"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("2 failures in");
    expect(result.stdout).toContain("src/a.test.ts");
    expect(result.stdout).toContain("    ✗ alpha keeps failing");
    expect(result.stdout).toContain("      error: boom");
  });

  test("failure-free capture reports no failures in both output modes", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("clean-555", CLEAN_LOG);
    const human = runCli(["triage", "clean"]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("No failures in");
    const json = runCli(["triage", "clean", "--json"]);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual([]);
  });

  test("accepts an explicit run dir path", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    const dir = seedFailRun("pathy-666", FAIL_LOG_A);
    const result = runCli(["triage", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveLength(2);
  });

  test("unknown run id errors naming it with exit 1", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    const result = runCli(["triage", "no-such-run"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("no run record matching 'no-such-run'");
  });

  test("missing triage target errors with usage and exit 1", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    const result = runCli(["triage"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("usage: giwt runs triage");
  });
});

describe("runs diff", () => {
  test("--json set-diffs failure identities between two runs", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("diff-a-777", FAIL_LOG_A);
    seedFailRun("diff-b-888", FAIL_LOG_B);
    const result = runCli(["diff", "diff-a", "diff-b", "--json"]);
    // Report, not gate: diffs exist, exit is still 0.
    expect(result.exitCode).toBe(0);
    const records = JSON.parse(result.stdout) as Array<{
      test: string;
      file?: string;
      kind: "new" | "fixed";
    }>;
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      test: "gamma new",
      file: "src/c.test.ts",
      kind: "new",
    });
    expect(records[1]).toEqual({
      test: "alpha keeps failing",
      file: "src/a.test.ts",
      kind: "fixed",
    });
  });

  test("human output prints new and fixed sections and never gates", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("diff-a-999", FAIL_LOG_A);
    seedFailRun("diff-b-201", FAIL_LOG_B);
    const result = runCli(["diff", "diff-a", "diff-b"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("  new (1):");
    expect(result.stdout).toContain("    ✗ gamma new (src/c.test.ts)");
    expect(result.stdout).toContain("  fixed (1):");
    expect(result.stdout).toContain("    ✓ alpha keeps failing (src/a.test.ts)");
    expect(result.stdout).not.toContain("beta flaky");
  });

  test("identical failure sets report no changes with exit 0", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("diff-a-202", FAIL_LOG_A);
    seedFailRun("diff-b-203", FAIL_LOG_A);
    const result = runCli(["diff", "diff-a", "diff-b"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No failure changes between");
  });

  test("unknown run id on either side errors naming it with exit 1", () => {
    root = mkdtempSync(join(scratchRoot(), "giwt-runs-test-"));
    seedFailRun("diff-a-204", FAIL_LOG_A);
    const result = runCli(["diff", "diff-a", "ghost-run"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("no run record matching 'ghost-run'");
  });
});
