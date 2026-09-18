// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the git plumbing helpers in `utils/git.ts`.
 *
 * Every case drives a throwaway repo (plus a linked worktree where the
 * main-vs-worktree distinction matters) and asserts observable results:
 * resolved paths, thrown errors, exit sentinels, parsed branch/worktree/
 * status rows. Child git is spawned with `isolatedGitEnv()` so ambient
 * GIT_* hook context cannot poison the fixtures, and `process.exit` is
 * mocked with a throwing sentinel (restored in `finally`) so the fail-fast
 * paths are asserted rather than killing the runner.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertNotInWorktree,
  findRepoRoot,
  getBranches,
  getRootBranch,
  getStatus,
  getWorktreeRoot,
  getWorktrees,
  gitSync,
  gitSyncQuiet,
  isolatedGitEnv,
  isProtected,
  stagedDependencyPaths,
} from "./git";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Run git in `cwd`; throws on failure so fixture setup never lies. */
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

/** Main repo on `main` with one commit. */
function makeRepo(): string {
  const root = tmp("giwt-git-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "f.txt"), "x\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** Run `fn` with process.exit mocked to a throwing `__exit:<code>` sentinel. */
function withExitMock(fn: () => void): { threw: boolean; code: number | null; } {
  const original = process.exit;
  let threw = false;
  let code: number | null = null;
  process.exit = ((c: number) => {
    threw = true;
    code = c;
    throw new Error(`__exit:${c}`);
  }) as never;
  try {
    fn();
    return { threw, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("__exit:")) throw error;
    return { threw, code };
  } finally {
    process.exit = original;
  }
}

function capture(): { text: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const out = spyOn(process.stdout, "write").mockImplementation(push as never);
  const err = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    text: () => chunks.join(""),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

describe("isProtected", () => {
  test("uses the settings default protected set", () => {
    expect(isProtected("main")).toBe(true);
    expect(isProtected("dev")).toBe(true);
    expect(isProtected("feature-x")).toBe(false);
  });

  test("honors an explicit protected list", () => {
    expect(isProtected("release", ["release"])).toBe(true);
    expect(isProtected("main", ["release"])).toBe(false);
  });
});

describe("getRootBranch", () => {
  test("returns the current branch", () => {
    expect(getRootBranch(makeRepo())).toBe("main");
  });

  test("falls back to master on detached HEAD", () => {
    const root = makeRepo();
    git(root, "checkout", "-q", "--detach");
    expect(getRootBranch(root)).toBe("master");
  });
});

describe("findRepoRoot", () => {
  test("resolves the main root from the root itself", () => {
    const root = makeRepo();
    expect(findRepoRoot(root)).toBe(root);
  });

  test("resolves the main root from a subdirectory", () => {
    const root = makeRepo();
    const sub = join(root, "deep", "nested");
    mkdirSync(sub, { recursive: true });
    expect(findRepoRoot(sub)).toBe(root);
  });

  test("resolves the main root from inside a linked worktree", () => {
    const root = makeRepo();
    const wt = join(root, "tree", "wt");
    git(root, "worktree", "add", "-q", "-b", "wt-branch", wt);
    const wtSub = join(wt, "sub");
    mkdirSync(wtSub, { recursive: true });
    expect(findRepoRoot(wt)).toBe(root);
    expect(findRepoRoot(wtSub)).toBe(root);
  });

  test("throws when the directory is not in a repository", () => {
    const outside = tmp("giwt-git-plain-");
    expect(() => findRepoRoot(outside)).toThrow(/not a git repository/);
  });
});

describe("getWorktreeRoot", () => {
  test("resolves the main root from the root and a subdirectory", () => {
    const root = makeRepo();
    const sub = join(root, "sub");
    mkdirSync(sub);
    expect(getWorktreeRoot(root)).toBe(root);
    expect(getWorktreeRoot(sub)).toBe(root);
  });

  test("resolves the linked worktree root, not the main root", () => {
    const root = makeRepo();
    const wt = join(root, "tree", "wt");
    git(root, "worktree", "add", "-q", "-b", "wt-branch", wt);
    expect(getWorktreeRoot(wt)).toBe(wt);
    expect(getWorktreeRoot(wt)).not.toBe(root);
  });

  test("throws when the directory is not in a repository", () => {
    const outside = tmp("giwt-git-plain-");
    expect(() => getWorktreeRoot(outside)).toThrow(/not a git repository/);
  });
});

describe("assertNotInWorktree", () => {
  test("returns without exiting from the main repo root", () => {
    const root = makeRepo();
    const prev = process.cwd();
    process.chdir(root);
    const cap = capture();
    try {
      const r = withExitMock(() => assertNotInWorktree("remove"));
      expect(r.threw).toBe(false);
      expect(cap.text()).toBe("");
    } finally {
      cap.restore();
      process.chdir(prev);
    }
  });

  test("exits 1 with guidance when run inside a linked worktree", () => {
    const root = makeRepo();
    const wt = join(root, "tree", "wt");
    git(root, "worktree", "add", "-q", "-b", "wt-branch", wt);
    const prev = process.cwd();
    process.chdir(wt);
    const cap = capture();
    try {
      const r = withExitMock(() => assertNotInWorktree("remove"));
      expect(r.threw).toBe(true);
      expect(r.code).toBe(1);
      const out = cap.text();
      expect(out).toContain("must be run from the repo root, not inside a worktree");
      expect(out).toContain("cd to the repo root and re-run: giwt remove");
    } finally {
      cap.restore();
      process.chdir(prev);
    }
  });

  test("treats a non-repo cwd as not-inside-a-worktree", () => {
    const outside = tmp("giwt-git-plain-");
    const prev = process.cwd();
    process.chdir(outside);
    const cap = capture();
    try {
      const r = withExitMock(() => assertNotInWorktree("remove"));
      expect(r.threw).toBe(false);
    } finally {
      cap.restore();
      process.chdir(prev);
    }
  });
});

describe("isolatedGitEnv", () => {
  test("strips GIT_* context and keeps everything else", () => {
    const prevDir = process.env.GIT_DIR;
    const prevKeep = process.env.GIWT_TEST_KEEP;
    process.env.GIT_DIR = "/tmp/poison";
    process.env.GIT_INDEX_FILE = "/tmp/poison-index";
    process.env.GIWT_TEST_KEEP = "yes";
    try {
      const env = isolatedGitEnv();
      expect(env.GIT_DIR).toBeUndefined();
      expect(env.GIT_INDEX_FILE).toBeUndefined();
      expect(env.GIWT_TEST_KEEP).toBe("yes");
      expect(env.PATH).toBe(process.env.PATH as string);
    } finally {
      if (prevDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prevDir;
      delete process.env.GIT_INDEX_FILE;
      if (prevKeep === undefined) delete process.env.GIWT_TEST_KEEP;
      else process.env.GIWT_TEST_KEEP = prevKeep;
    }
  });
});

describe("gitSync", () => {
  test("returns trimmed stdout on success", () => {
    const root = makeRepo();
    expect(gitSync(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  test("throws with git stderr on failure", () => {
    const root = makeRepo();
    expect(() => gitSync(root, "rev-parse", "--verify", "no-such-ref")).toThrow();
    // The thrown message is git's stderr, so the failing object name is visible.
    expect(() => gitSync(root, "cat-file", "-e", "no-such-object")).toThrow(/no-such-object/);
  });
});

describe("gitSyncQuiet", () => {
  test("returns stdout on success and empty string on failure", () => {
    const root = makeRepo();
    expect(gitSyncQuiet(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(gitSyncQuiet(root, "rev-parse", "--verify", "no-such-ref")).toBe("");
  });
});

describe("stagedDependencyPaths", () => {
  test("is empty for a plain staged file", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src.ts"), "export {};\n");
    git(root, "add", "src.ts");
    expect(stagedDependencyPaths(root)).toEqual([]);
  });

  test("flags a staged node_modules directory and its contents", () => {
    const root = makeRepo();
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module.exports = {};\n");
    mkdirSync(join(root, "sub", "node_modules"), { recursive: true });
    writeFileSync(join(root, "sub", "node_modules", "x.js"), "x\n");
    writeFileSync(join(root, "keep.ts"), "keep\n");
    // node_modules is ignored by default; force-add to stage the leak.
    git(root, "add", "-f", "node_modules/pkg/index.js", "sub/node_modules/x.js", "keep.ts");
    const staged = stagedDependencyPaths(root).sort();
    expect(staged).toEqual(["node_modules/pkg/index.js", "sub/node_modules/x.js"]);
  });
});

describe("getBranches", () => {
  test("lists branches with current and protected flags", async () => {
    const root = makeRepo();
    git(root, "branch", "feature-a");
    git(root, "branch", "release");
    const branches = await getBranches(root, ["main", "release"]);
    const byName = Object.fromEntries(branches.map((b) => [b.name, b]));
    expect(Object.keys(byName).sort()).toEqual(["feature-a", "main", "release"]);
    expect(byName.main!.current).toBe(true);
    expect(byName.main!.protected).toBe(true);
    expect(byName.release!.protected).toBe(true);
    expect(byName["feature-a"]!.current).toBe(false);
    expect(byName["feature-a"]!.protected).toBe(false);
  });
});

describe("getWorktrees", () => {
  test("parses the main checkout and a linked worktree", async () => {
    const root = makeRepo();
    const wt = join(root, "tree", "wt");
    git(root, "worktree", "add", "-q", "-b", "wt-branch", wt);
    const worktrees = await getWorktrees(root);
    expect(worktrees).toHaveLength(2);
    const mainEntry = worktrees.find((w) => w.path === root);
    const wtEntry = worktrees.find((w) => w.path === wt);
    expect(mainEntry).toBeDefined();
    expect(mainEntry!.branch).toBe("refs/heads/main");
    expect(mainEntry!.HEAD).toMatch(/^[0-9a-f]{40}$/);
    expect(wtEntry).toBeDefined();
    expect(wtEntry!.branch).toBe("refs/heads/wt-branch");
  });
});

describe("getStatus", () => {
  test("counts ahead/behind against the root branch and reports clean", async () => {
    const root = makeRepo();
    git(root, "checkout", "-q", "-b", "feature");
    writeFileSync(join(root, "g.txt"), "g\n");
    git(root, "add", "g.txt");
    git(root, "commit", "-q", "-m", "feature work");
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, "m.txt"), "m\n");
    git(root, "add", "m.txt");
    git(root, "commit", "-q", "-m", "main work");

    const status = await getStatus(root, "feature");
    expect(status.branch).toBe("feature");
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(1);
    expect(status.clean).toBe(true);

    writeFileSync(join(root, "dirty.txt"), "dirty\n");
    expect((await getStatus(root, "feature")).clean).toBe(false);
  });
});
