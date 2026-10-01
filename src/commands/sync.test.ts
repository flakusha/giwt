// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt sync` machine output flags (--json/--toml/--emoji).
 *
 * Convention: NO mock.module — the CLI runs as a subprocess
 * (`bun src/cli.ts sync …` with REPO_ROOT pinned to the fixture), so the
 * sync command module never loads in the coverage process (same reasoning
 * as runs.test.ts and the plan matrix flags describe). The mismatch
 * fixture (ticket file, empty index) drives the summary counters without
 * needing the git-issue registry; the green path is registry-dependent
 * and skipped when the CLI is absent.
 *
 * Resource contract (parallel-safe): each test owns a unique mkdtemp git
 * repo torn down in afterEach; every subprocess spawn is bounded by a
 * 30s timeout.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "cli.ts");

let root = "";

function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_") || key === "GNUPGHOME") continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function gitOut(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function probeGitIssueCli(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "giwt-sync-flag-probe-"));
  try {
    gitOut(dir, "init", "-q", "-b", "main");
    gitOut(dir, "config", "user.email", "giwt-test@example.com");
    gitOut(dir, "config", "user.name", "giwt test");
    gitOut(dir, "config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    gitOut(dir, "add", "-A");
    gitOut(dir, "commit", "-q", "-m", "seed");
    gitOut(dir, "issue", "ls", "--all", "--format", "oneline");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GIT_ISSUE_AVAILABLE = probeGitIssueCli();

/** Fresh git repo rooted at the fixture itself (REPO_ROOT target). */
function makeRepo(slug: string): string {
  root = mkdtempSync(join(tmpdir(), `giwt-sync-flags-${slug}-`));
  gitOut(root, "init", "-q", "-b", "main");
  gitOut(root, "config", "user.email", "giwt-test@example.com");
  gitOut(root, "config", "user.name", "giwt test");
  gitOut(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  gitOut(root, "add", "-A");
  gitOut(root, "commit", "-q", "-m", "seed");
  return root;
}

/** Mismatch fixture: one ticket .md, empty index — summary has orphans. */
function seedMismatch(repo: string): void {
  const dir = join(repo, ".plan", "tickets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "TASK-orphan.md"),
    "# TASK: orphan ticket\n\n**Status:** open\n**Priority:** medium\n\nBody.\n",
  );
  writeFileSync(join(dir, "index.json"), "{}\n");
}

function runCli(
  args: string[],
): { stdout: string; stderr: string; exitCode: number; } {
  const result = Bun.spawnSync(["bun", CLI, "sync", ...args], {
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
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

describe("sync: machine output flags (mismatch fixture)", () => {
  test("--json parses back to the summary counters", () => {
    makeRepo("json");
    seedMismatch(root);
    const result = runCli(["--json"]);
    expect(result.exitCode).toBe(1);
    const rec = JSON.parse(result.stdout) as {
      tickets: number;
      issuesRemaining: number;
    };
    expect(rec.tickets).toBe(1);
    expect(rec.issuesRemaining).toBe(1);
  });

  test("--toml round-trips through Bun.TOML.parse", () => {
    makeRepo("toml");
    seedMismatch(root);
    const result = runCli(["--toml"]);
    expect(result.exitCode).toBe(1);
    const parsed = Bun.TOML.parse(result.stdout) as {
      value?: { tickets: number; };
      items?: Array<{ tickets: number; }>;
    };
    const rec = parsed.value ?? parsed.items![0]!;
    expect(rec.tickets).toBe(1);
  });

  test("--emoji prints one warning line with the counters", () => {
    makeRepo("emoji");
    seedMismatch(root);
    const result = runCli(["--emoji"]);
    expect(result.exitCode).toBe(1);
    const lines = result.stdout.split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("⚠\uFE0F");
    expect(lines[0]).toContain("tickets: 1");
  });

  test("multiple flags resolve json over emoji with a warn", () => {
    makeRepo("multi");
    seedMismatch(root);
    const result = runCli(["--emoji", "--json"]);
    expect(result.exitCode).toBe(1);
    JSON.parse(result.stdout);
    expect(result.stderr).toContain("multiple output flags");
  });

  test("human output keeps the report on stdout and no machine payload", () => {
    makeRepo("human");
    seedMismatch(root);
    const result = runCli([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toMatch(/^\{/m);
    expect(result.stdout).toContain("orphan");
  });
});

describe.skipIf(!GIT_ISSUE_AVAILABLE)("sync: green path (registry)", () => {
  test("--emoji prints one check line when everything is in sync", () => {
    makeRepo("green");
    gitOut(root, "issue", "create", "TASK-green: green ticket", "-m", "body");
    const ls = gitOut(root, "issue", "ls", "--all", "--format", "oneline").trim();
    const hash = ls.split("\n")[0]!.split(" ")[0]!.slice(0, 7);
    const dir = join(root, ".plan", "tickets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TASK-green.md"),
      "# TASK: green ticket\n\n**Status:** open\n**Priority:** medium\n**Epic:** EPIC-1\n\nBody.\n\ngit issue: "
        + hash + "\n",
    );
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify(
        {
          "TASK-GREEN": {
            hash,
            extid: "TASK-GREEN",
            type: "TASK",
            title: "green ticket",
            label: "task",
            priority: "medium",
            epic: "EPIC-1",
            tags: [],
            source: ".plan/tickets/TASK-green.md",
            status: "open",
            git_issue: hash,
          },
        },
        null,
        2,
      ) + "\n",
    );
    const result = runCli(["--emoji"]);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("✅");
  });
});
