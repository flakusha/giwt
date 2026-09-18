// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the remove command's error paths: missing branch argument,
 * uncommitted tracked changes, and a `git worktree remove` that fails on
 * untracked files (invisible to the diff-based dirty check). Healthy and
 * stale-registration removal live in worktree-registry.test.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { setLogLevel, setOutputFormat } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute } from "./remove";

let root: string;
let treeDir: string;
let config: WorktreeConfig;

/** Run git in the fixture repo (or a given dir); throw on failure. */
function git(args: string[], cwd: string = root): string {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: env as Record<string, string>,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

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

/** Mock process.exit to record the code and abort via a thrown marker. */
function mockExit(): { calls: number[]; restore: () => void; } {
  const original = process.exit;
  const calls: number[] = [];
  process.exit = ((code: number) => {
    calls.push(code);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    calls,
    restore: () => {
      process.exit = original;
    },
  };
}

function addWorktree(branch: string): string {
  const wtPath = resolve(treeDir, branchToPath(branch));
  git(["worktree", "add", "-q", "-b", branch, wtPath, "main"]);
  return wtPath;
}

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  root = mkdtempSync(join(tmpdir(), "giwt-remove-test-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-qm", "seed"]);
  treeDir = resolve(root, "tree");
  config = { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("remove: error paths", () => {
  test("errors with usage when no branch is given", async () => {
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute([], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("branch name required");
    expect(cap.lines()).toContain("Usage: giwt remove <branch>");
  });

  test("refuses a worktree with modified tracked files", async () => {
    const wtPath = addWorktree("dirty-remove");
    writeFileSync(resolve(wtPath, "seed.txt"), "modified\n");
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute(["dirty-remove"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("worktree has uncommitted changes");
    expect(cap.lines()).toContain(`cd ${wtPath} && git stash`);
    expect(existsSync(resolve(wtPath, ".git"))).toBe(true);
  });

  test("reports the git failure when worktree remove fails on untracked files", async () => {
    const wtPath = addWorktree("untracked-remove");
    // Untracked files pass the diff-based dirty check but make
    // `git worktree remove` refuse the checkout.
    writeFileSync(resolve(wtPath, "untracked.txt"), "stray\n");
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute(["untracked-remove"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("worktree remove failed (exit 128)");
    expect(existsSync(resolve(wtPath, ".git"))).toBe(true);
  });
});
