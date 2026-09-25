// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt create` — add a linked worktree for a branch that already
 * exists.
 *
 * Contract covered here:
 * - argument and protection guards abort before touching the repo;
 * - a worktree path with a live directory is reported, never clobbered;
 * - a stale registration (directory gone) is pruned and re-added, a missing
 *   branch ref is recovered from the registration's last-known HEAD, and a
 *   branch that cannot be recovered errors out with a next step;
 * - agent GPG signing and .githooks wiring land inside the new worktree;
 * - git's own failures (branch checked out elsewhere) surface git's stderr
 *   and a non-zero exit.
 *
 * Fixtures are real scratch repos. Every child git runs with
 * isolatedGitEnv() so the surrounding hook's GIT_* context cannot leak in.
 * Resource contract: each test owns one fresh mkdtemp() checkout (plus any
 * worktrees it registers), removed in afterEach; no fixed paths and no
 * shared mutable state, so the file is safe under parallel execution.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute } from "./create";

let root: string;
let treeDir: string;
let config: WorktreeConfig;

/** Run git in the fixture (default: the main checkout); throw on failure. */
function git(args: string[], cwd: string = root): string {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

/** Exit code of a git probe that is expected to fail (existence checks). */
function gitExit(args: string[], cwd: string = root): number {
  return Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  }).exitCode;
}

/** Capture log()/raw() traffic on both streams; keeps test output clean. */
function captureStreams(): { lines: () => string; restore: () => void; } {
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

/** Run `create` for `args` and return everything log()/raw() wrote. */
async function run(args: string[]): Promise<string> {
  const cap = captureStreams();
  try {
    await execute(args, config);
    return cap.lines();
  } finally {
    cap.restore();
  }
}

/** Run `create` expecting process.exit(1); returns all captured output. */
async function runExpectExit1(args: string[]): Promise<string> {
  const cap = captureStreams();
  const original = process.exit;
  const codes: number[] = [];
  process.exit = ((code: number) => {
    codes.push(code);
    throw new Error(`__exit__:${code}`);
  }) as never;
  try {
    let aborted = false;
    try {
      await execute(args, config);
    } catch (err) {
      expect((err as Error).message).toBe("__exit__:1");
      aborted = true;
    }
    expect(aborted).toBe(true);
    expect(codes).toEqual([1]);
    return cap.lines();
  } finally {
    process.exit = original;
    cap.restore();
  }
}

/** Register a real linked worktree for a fresh branch off main. */
function addWorktree(branch: string): string {
  const wtPath = resolve(treeDir, branchToPath(branch));
  git(["worktree", "add", "-q", "-b", branch, wtPath, "main"]);
  return wtPath;
}

/**
 * Build a stale registration: the worktree gets its own commit, then its
 * directory is rm -rf'd and its branch ref force-deleted (update-ref
 * bypasses the checked-out guard). With `detach` the worktree is left on a
 * detached HEAD first — the shape where the registration HEAD holds a real,
 * recoverable sha.
 */
function makeStale(
  branch: string,
  opts: { detach?: boolean; } = {},
): { wtPath: string; head: string; } {
  const wtPath = addWorktree(branch);
  writeFileSync(join(wtPath, "unique.txt"), `${branch}\n`);
  git(["add", "unique.txt"], wtPath);
  git(["commit", "-qm", `unique ${branch}`], wtPath);
  if (opts.detach) git(["checkout", "--detach", "-q"], wtPath);
  const head = git(["rev-parse", "HEAD"], wtPath).trim();
  rmSync(wtPath, { recursive: true, force: true });
  git(["update-ref", "-d", `refs/heads/${branch}`]);
  return { wtPath, head };
}

/**
 * Run `fn` with `gpg` stubbed to exit `exitCode`. The signing block only
 * enables signing when `gpg --list-keys` AND `--list-secret-keys` both
 * succeed, and a populated keyring is not something a test may assume. A
 * PATH override does not reach Bun's spawn lookup, so the stub wraps
 * Bun.spawnSync and delegates every other command to the real one.
 */
async function withStubGpg(fn: () => Promise<void>, exitCode = 0): Promise<void> {
  const real = Bun.spawnSync;
  Bun.spawnSync = ((cmd: string[], opts?: unknown) => {
    if (cmd[0] === "gpg") {
      return { exitCode, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    return real(cmd as never, opts as never);
  }) as unknown as typeof Bun.spawnSync;
  try {
    await fn();
  } finally {
    Bun.spawnSync = real;
  }
}

beforeEach(() => {
  setLogLevel("info");
  root = mkdtempSync(join(tmpdir(), "giwt-create-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "seed.txt"]);
  git(["commit", "-qm", "seed"]);
  treeDir = resolve(root, "tree");
  mkdirSync(treeDir);
  config = { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("create: argument and registry guards", () => {
  test("requires a branch name and prints usage", async () => {
    const out = await runExpectExit1([]);
    expect(out).toContain("branch name required");
    expect(out).toContain("Usage: giwt create <branch>");
  });

  test("refuses a protected branch name", async () => {
    const out = await runExpectExit1(["master"]);
    expect(out).toContain("cannot create worktree for protected branch 'master'");
    expect(existsSync(resolve(treeDir, "master"))).toBe(false);
  });

  test("reports a branch that does not exist with a recovery command", async () => {
    const out = await runExpectExit1(["never-created"]);
    expect(out).toContain("branch 'never-created' does not exist");
    expect(out).toContain("giwt new-branch never-created");
    expect(existsSync(resolve(treeDir, "never-created"))).toBe(false);
  });

  test("warns and leaves a live worktree alone", async () => {
    const wtPath = addWorktree("already-there");
    const out = await run(["already-there"]);
    expect(out).toContain(`worktree already exists: ${wtPath}`);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("already-there");
  });
});

describe("create: stale registry reconciliation", () => {
  test("prunes a stale registration and re-adds the worktree", async () => {
    const wtPath = addWorktree("drifted");
    rmSync(wtPath, { recursive: true, force: true });
    const out = await run(["drifted"]);
    expect(out).toContain("pruning stale worktree registration: " + wtPath);
    expect(existsSync(join(wtPath, ".git"))).toBe(true);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("drifted");
  });

  test("clears an empty leftover directory instead of warning", async () => {
    git(["branch", "husk", "main"]);
    const husk = resolve(treeDir, "husk");
    mkdirSync(husk);
    const out = await run(["husk"]);
    expect(out).not.toContain("already exists");
    expect(out).toContain("removed empty leftover directory");
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], husk).trim()).toBe("husk");
  });

  test("warns about an unregistered non-empty directory and keeps its files", async () => {
    git(["branch", "foreign", "main"]);
    const dir = resolve(treeDir, "foreign");
    mkdirSync(dir);
    writeFileSync(join(dir, "user-file.txt"), "keep me\n");
    const out = await run(["foreign"]);
    expect(out).toContain(`directory exists but is not a registered worktree: ${dir}`);
    expect(out).toContain(`rm -rf ${dir}`);
    expect(existsSync(join(dir, "user-file.txt"))).toBe(true);
  });

  test("recovers a branch whose ref is gone from the registration HEAD", async () => {
    const { wtPath, head } = makeStale("recovered", { detach: true });
    const out = await run(["recovered"]);
    expect(out).toContain("recovered branch 'recovered'");
    expect(git(["rev-parse", "refs/heads/recovered"]).trim()).toBe(head);
    expect(existsSync(join(wtPath, ".git"))).toBe(true);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("recovered");
  });

  test("errors with a next step when the last known commit is gone", async () => {
    const { head } = makeStale("unrecoverable", { detach: true });
    rmSync(join(root, ".git", "objects", head.slice(0, 2), head.slice(2)));
    const out = await runExpectExit1(["unrecoverable"]);
    expect(out).toContain("cannot be recovered");
    expect(out).toContain("git branch unrecoverable <base>");
    expect(gitExit(["rev-parse", "--verify", "refs/heads/unrecoverable"])).not.toBe(0);
  });
});

describe("create: worktree setup", () => {
  test("creates a worktree for an existing branch at treeDir", async () => {
    git(["branch", "plain", "main"]);
    const wtPath = resolve(treeDir, "plain");
    const out = await run(["plain"]);
    expect(out).toContain("Creating worktree for branch: plain");
    expect(out).toContain(`Created: ${wtPath}`);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("plain");
    expect(git(["worktree", "list", "--porcelain"])).toContain(wtPath);
  });

  test("configures .githooks in the new worktree when the repo has one", async () => {
    const hooksDir = join(root, ".githooks");
    mkdirSync(hooksDir);
    git(["branch", "hooked", "main"]);
    const wtPath = resolve(treeDir, "hooked");
    const out = await run(["hooked"]);
    expect(out).toContain("hooks configured");
    expect(git(["config", "--get", "core.hooksPath"], wtPath).trim()).toBe(hooksDir);
  });

  test("enables commit signing when the agent key has a usable secret", async () => {
    config.agentGpgKeyId = "0123456789ABCDEF";
    git(["branch", "signed", "main"]);
    await withStubGpg(async () => {
      const wtPath = resolve(treeDir, "signed");
      const out = await run(["signed"]);
      expect(out).toContain("GPG signing enabled (key: 01234567...)");
      expect(git(["config", "--get", "commit.gpgsign"], wtPath).trim()).toBe("true");
      expect(git(["config", "--get", "user.signingkey"], wtPath).trim()).toBe("0123456789ABCDEF");
    });
  });

  test("leaves the new worktree unsigned when gpg cannot find the key", async () => {
    config.agentGpgKeyId = "0123456789ABCDEF";
    git(["branch", "unsigned", "main"]);
    await withStubGpg(async () => {
      const wtPath = resolve(treeDir, "unsigned");
      const out = await run(["unsigned"]);
      expect(out).not.toContain("GPG signing enabled");
      // the fixture's commit.gpgsign=false survives: nothing enabled it
      expect(git(["config", "--get", "commit.gpgsign"], wtPath).trim()).toBe("false");
      expect(gitExit(["config", "--get", "user.signingkey"], wtPath)).not.toBe(0);
    }, 1);
  });

  test("surfaces git's error when the branch is already checked out elsewhere", async () => {
    const elsewhere = resolve(root, "elsewhere");
    mkdirSync(elsewhere);
    git(["worktree", "add", "-q", "-b", "in-use", resolve(elsewhere, "in-use"), "main"]);
    const out = await runExpectExit1(["in-use"]);
    expect(out).toContain("worktree add failed (exit 128)");
    expect(out).toContain("is already used by worktree");
    expect(existsSync(resolve(treeDir, "in-use"))).toBe(false);
  });
});
