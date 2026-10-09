// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "../utils/scratch-tmp";
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the remove command's error paths: missing branch argument,
 * uncommitted tracked changes, and a `git worktree remove` that fails on
 * untracked files (invisible to the diff-based dirty check). Healthy and
 * stale-registration removal live in worktree-registry.test.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  root = mkdtempSync(join(scratchRoot(), "giwt-remove-test-"));
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
    expect(cap.lines()).toContain("Usage: giwt remove <branch|path>");
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

describe("remove --branch-only", () => {
  beforeEach(() => {
    // Fixture root branch is 'main'; point the merged-check at it.
    config = {
      ...config,
      settings: { ...config.settings, branches: { ...config.settings.branches, root: "main" } },
    };
  });

  function branchSha(branch: string): string {
    return git(["rev-parse", branch]).trim();
  }

  function branchExists(branch: string): boolean {
    const p = Bun.spawnSync(["git", "-C", root, "rev-parse", "--verify", `refs/heads/${branch}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return p.exitCode === 0;
  }

  test("deletes a merged branch with no worktree and reports the SHA", async () => {
    git(["branch", "merged-gone", "main"]);
    const cap = captureOutput();
    try {
      await execute(["merged-gone", "--branch-only"], config);
    } finally {
      cap.restore();
    }
    expect(branchExists("merged-gone")).toBe(false);
    expect(cap.lines()).toContain(
      `deleted branch 'merged-gone' (tip ${branchSha("main")} recoverable from reflog)`,
    );
  });

  test("falls back to HEAD for the merged check when the configured root ref is missing", async () => {
    // Root='dev' does not exist in this fixture (trunk is main). A branch at
    // HEAD must still count as merged, not force-required. Explicit config:
    // the surrounding describe re-points root at main.
    const devConfig: WorktreeConfig = {
      ...config,
      settings: { ...config.settings, branches: { ...config.settings.branches, root: "dev" } },
    };
    expect(devConfig.settings.branches.root).toBe("dev");
    git(["branch", "head-merged", "HEAD"]);
    const cap = captureOutput();
    try {
      await execute(["head-merged", "--branch-only"], devConfig);
    } finally {
      cap.restore();
    }
    expect(branchExists("head-merged")).toBe(false);
    expect(cap.lines()).not.toContain("not fully merged");
  });

  test("refuses an unmerged branch without --force, printing SHA and recovery", async () => {
    git(["checkout", "-qb", "unmerged-gone"]);
    writeFileSync(join(root, "wip.txt"), "wip\n");
    git(["add", "wip.txt"]);
    git(["commit", "-qm", "wip"]);
    git(["checkout", "main"]);
    const sha = branchSha("unmerged-gone");

    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute(["unmerged-gone", "--branch-only"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain(`branch 'unmerged-gone' is not fully merged (tip ${sha})`);
    expect(cap.lines()).toContain(`git branch -D unmerged-gone`);
    expect(branchExists("unmerged-gone")).toBe(true);
  });

  test("--force deletes an unmerged branch (branch -D)", async () => {
    git(["checkout", "-qb", "forced-gone"]);
    writeFileSync(join(root, "wip2.txt"), "wip\n");
    git(["add", "wip2.txt"]);
    git(["commit", "-qm", "wip2"]);
    git(["checkout", "main"]);
    const sha = branchSha("forced-gone");

    const cap = captureOutput();
    try {
      await execute(["forced-gone", "--branch-only", "--force"], config);
    } finally {
      cap.restore();
    }
    expect(branchExists("forced-gone")).toBe(false);
    expect(cap.lines()).toContain(
      `deleted branch 'forced-gone' (tip ${sha} recoverable from reflog)`,
    );
  });

  test("refuses when the worktree still exists, directing to plain remove", async () => {
    addWorktree("still-here");
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute(["still-here", "--branch-only"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("still exists at");
    expect(cap.lines()).toContain("giwt remove still-here");
    expect(branchExists("still-here")).toBe(true);
  });

  test("errors on a nonexistent branch", async () => {
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute(["no-such-branch", "--branch-only"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("no such branch: 'no-such-branch'");
  });

  test("refuses the branch checked out in the repo root (even --force), with a switch-away remedy", async () => {
    // The fixture root IS the repo root here: create the branch at HEAD so
    // it reads as merged, then check it out — the guard must fire before
    // any delete, instead of gitRun's raw throw on the --force path.
    git(["branch", "root-checked-out", "main"]);
    git(["checkout", "-q", "root-checked-out"]);
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute(["root-checked-out", "--branch-only", "--force"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("is checked out in");
    expect(cap.lines()).toContain("switch away first");
    expect(cap.lines()).toContain("giwt remove root-checked-out --branch-only --force");
    expect(branchExists("root-checked-out")).toBe(true);
    git(["checkout", "-q", "main"]);
  });

  test("unknown flags are refused", async () => {
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute(["some-branch", "--bogus"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("unknown flag '--bogus'");
  });

  test("default path unchanged: worktree removed; merged branch deleted, unmerged kept", async () => {
    const wtPath = addWorktree("keep-branch");
    const cap = captureOutput();
    try {
      await execute(["keep-branch"], config);
    } finally {
      cap.restore();
    }
    expect(existsSync(resolve(wtPath, ".git"))).toBe(false);
    // Branch was cut at main → fully merged → post-removal cleanup deletes it.
    expect(branchExists("keep-branch")).toBe(false);
    expect(cap.lines()).toContain("deleted merged branch 'keep-branch'");
  });

  test("default path keeps an unmerged branch after worktree removal", async () => {
    const wtPath = addWorktree("diverged-keep");
    writeFileSync(resolve(wtPath, "wip.txt"), "wip\n");
    git(["add", "wip.txt"], wtPath);
    git(["commit", "-qm", "wip"], wtPath);
    const cap = captureOutput();
    try {
      await execute(["diverged-keep"], config);
    } finally {
      cap.restore();
    }
    expect(existsSync(resolve(wtPath, ".git"))).toBe(false);
    expect(branchExists("diverged-keep")).toBe(true);
    expect(cap.lines()).toContain("branch 'diverged-keep' kept (unmerged)");
  });
});

describe("remove by worktree path", () => {
  function branchExists(branch: string): boolean {
    const p = Bun.spawnSync(["git", "-C", root, "rev-parse", "--verify", `refs/heads/${branch}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return p.exitCode === 0;
  }

  beforeEach(() => {
    config = {
      ...config,
      settings: { ...config.settings, branches: { ...config.settings.branches, root: "main" } },
    };
  });

  test("removes a worktree addressed by its path, deriving the branch from the registry", async () => {
    // Slash branch: path inversion (branchToPath) would lose the '/', so the
    // positional can only resolve through the worktree registry.
    const wtPath = addWorktree("feat/slash-branch");
    const cap = captureOutput();
    try {
      await execute([wtPath], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain(`resolved path target: ${wtPath} (branch 'feat/slash-branch')`);
    expect(existsSync(resolve(wtPath, ".git"))).toBe(false);
    // Branch was cut at main → merged → post-removal cleanup deletes it.
    expect(branchExists("feat/slash-branch")).toBe(false);
    expect(cap.lines()).toContain("deleted merged branch 'feat/slash-branch'");
  });

  test("refuses a path-targeted worktree with uncommitted changes", async () => {
    const wtPath = addWorktree("path-dirty");
    writeFileSync(resolve(wtPath, "seed.txt"), "modified\n");
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await execute([wtPath], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("worktree has uncommitted changes");
    expect(existsSync(resolve(wtPath, ".git"))).toBe(true);
  });

  test("keeps an unmerged branch when removed by path", async () => {
    const wtPath = addWorktree("path-diverged");
    writeFileSync(resolve(wtPath, "wip.txt"), "wip\n");
    git(["add", "wip.txt"], wtPath);
    git(["commit", "-qm", "wip"], wtPath);
    const cap = captureOutput();
    try {
      await execute([wtPath], config);
    } finally {
      cap.restore();
    }
    expect(existsSync(resolve(wtPath, ".git"))).toBe(false);
    expect(branchExists("path-diverged")).toBe(true);
    expect(cap.lines()).toContain("branch 'path-diverged' kept (unmerged)");
  });

  test("removes a detached worktree by path without branch cleanup", async () => {
    const wtPath = resolve(treeDir, "detached-wt");
    git(["worktree", "add", "-q", "--detach", wtPath, "main"]);
    const cap = captureOutput();
    try {
      await execute([wtPath], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain(`resolved path target: ${wtPath} (detached)`);
    expect(existsSync(resolve(wtPath, ".git"))).toBe(false);
    expect(cap.lines()).toContain("Removed");
    expect(cap.lines()).not.toContain("kept (unmerged)");
  });
});
