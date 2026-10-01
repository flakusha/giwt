// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { tmpdir } from "node:os";
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
    root = mkdtempSync(join(tmpdir(), "giwt-runs-test-"));
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
    root = mkdtempSync(join(tmpdir(), "giwt-runs-test-"));
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
    root = mkdtempSync(join(tmpdir(), "giwt-runs-test-"));
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
