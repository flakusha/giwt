// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt new-branch`.
 *
 * Two families of behavior:
 *
 * 1. Error paths — ticket FIX-errors-carry-no-remedy. The old missing-base
 *    error was just "base 'dev' does not exist" — no candidates, no giwt.toml
 *    hint — so an agent had to rediscover valid inputs by trial. The fix
 *    lists the existing branch candidates, points at the [branches] root
 *    override in giwt.toml, and names the explicit-base escape hatch.
 * 2. Success paths over a real scratch repo: the new branch is created from
 *    the requested base, its linked worktree lands at treeDir/<branch>, and
 *    .githooks plus agent GPG signing are configured inside it.
 *
 * Strategy: build a real tiny git repo in /tmp (master + one extra branch,
 * deliberately NO `dev`, the settings default root) and drive the real
 * `execute()` entry point. Resource contract: each test owns its own
 * mkdtemp() checkout, removed in afterEach — no fixed paths, no ordering
 * dependence, so the file is safe under parallel execution.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute } from "./new-branch";

let root: string;
let config: WorktreeConfig;

/**
 * Run git in the fixture (default: the repo root). The hook/parent
 * environment's git context (GIT_DIR, GIT_INDEX_FILE, …) is stripped: hooks
 * run with relative paths that a child `git -C <tmpdir>` would otherwise
 * resolve against the fixture and fail with ENOTDIR.
 */
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

beforeEach(() => {
  setLogLevel("info");
  root = mkdtempSync(join(tmpdir(), "giwt-new-branch-"));
  git(["init", "--initial-branch=master"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["commit", "--allow-empty", "-m", "base"]);
  git(["branch", "staging"]);
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Capture log/raw output and replace process.exit with a throwing stub.
 * `execute()` runs synchronously up to the exit, so the rejection carries
 * the stub error while the captured output is already complete.
 */
function installSpies(): { collect: () => string; restore: () => void; } {
  const outSpy = spyOn(process.stdout, "write");
  const errSpy = spyOn(process.stderr, "write");
  const exitSpy = spyOn(process, "exit").mockImplementation(
    ((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit,
  );
  outSpy.mockImplementation(() => true);
  errSpy.mockImplementation(() => true);
  return {
    collect: () =>
      [
        ...outSpy.mock.calls.map((args) => String(args[0])),
        ...errSpy.mock.calls.map((args) => String(args[0])),
      ].join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    },
  };
}

/** Await a command that must abort via process.exit(1); returns all output. */
async function runExpectExit1(runner: () => Promise<void>): Promise<string> {
  const spies = installSpies();
  try {
    let aborted = false;
    try {
      await runner();
    } catch (err) {
      expect((err as Error).message).toBe("__exit__:1");
      aborted = true;
    }
    expect(aborted).toBe(true);
    return spies.collect();
  } finally {
    spies.restore();
  }
}

/** Await a command that must succeed; returns everything log()/raw() wrote. */
async function runExpectSuccess(runner: () => Promise<void>): Promise<string> {
  const spies = installSpies();
  try {
    await runner();
    return spies.collect();
  } finally {
    spies.restore();
  }
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

describe("new-branch missing-base error (FIX-errors-carry-no-remedy)", () => {
  test("explicit missing base lists candidates, giwt.toml override, and escape hatch", async () => {
    const out = await runExpectExit1(() =>
      execute(["tooling-plan-validate-integration", "no-such-base"], config)
    );
    expect(out).toContain("base 'no-such-base' does not exist");
    // Existing candidate base refs are listed.
    expect(out).toContain("Existing branches you can base on:");
    expect(out).toContain("master");
    expect(out).toContain("staging");
    // The [branches] root override in giwt.toml is mentioned.
    expect(out).toContain("[branches] root");
    expect(out).toContain("giwt.toml");
    // An explicit command is offered as the actionable next step.
    expect(out).toContain("giwt new-branch tooling-plan-validate-integration <base>");
  });

  test("default (configured) base missing reports the configured root name", async () => {
    // DEFAULT_SETTINGS.branches.root is "dev"; the fixture has no dev
    // branch, mirroring the ticket evidence (repo branches from master).
    expect(DEFAULT_SETTINGS.branches.root).toBe("dev");
    const out = await runExpectExit1(() => execute(["some-new-branch"], config));
    expect(out).toContain("base 'dev' does not exist");
    expect(out).toContain("[branches] root");
    expect(out).toContain("(currently 'dev')");
    expect(out).toContain("master");
  });

  test("suggests a commit or tag when the repo has no local branch at all", async () => {
    const emptyRoot = join(root, "empty-repo");
    mkdirSync(emptyRoot);
    git(["init", "--initial-branch=master"], emptyRoot);
    const emptyConfig: WorktreeConfig = {
      ...config,
      repoRoot: emptyRoot,
      treeDir: join(emptyRoot, "tree"),
    };
    const out = await runExpectExit1(() => execute(["fresh"], emptyConfig));
    expect(out).toContain("base 'dev' does not exist");
    expect(out).toContain("No local branches exist yet");
  });
});

describe("new-branch argument guards", () => {
  test("requires a branch name and prints usage", async () => {
    const out = await runExpectExit1(() => execute([], config));
    expect(out).toContain("branch name required");
    expect(out).toContain("Usage: giwt new-branch <branch> [base]");
    expect(existsSync(join(root, "tree"))).toBe(false);
  });

  test("refuses a protected branch name", async () => {
    const out = await runExpectExit1(() => execute(["dev"], config));
    expect(out).toContain("cannot create worktree for protected branch 'dev'");
    expect(gitExit(["rev-parse", "--verify", "refs/heads/dev"])).not.toBe(0);
  });

  test("refuses a branch that already exists", async () => {
    // The guard's own process.exit sits inside the try that probes branch
    // existence, so the throwing sentinel is swallowed there and the run
    // aborts on git's later refusal instead; the guard's message is the
    // observable contract, and no worktree lands at the path either way.
    const wtPath = resolve(config.treeDir, "staging");
    const out = await runExpectExit1(() => execute(["staging", "master"], config));
    expect(out).toContain("branch 'staging' already exists");
    expect(existsSync(join(wtPath, ".git"))).toBe(false);
    expect(gitExit(["rev-parse", "--verify", "refs/heads/staging"])).toBe(0);
  });
});

describe("new-branch success path", () => {
  test("creates the branch and its worktree at treeDir from an explicit base", async () => {
    // Slashes in branch names become dashes in the tree path.
    expect(branchToPath("feature/login")).toBe("feature-login");
    const wtPath = resolve(config.treeDir, "feature-login");
    const out = await runExpectSuccess(() => execute(["feature/login", "master"], config));
    expect(out).toContain("Creating new branch 'feature/login' from 'master'");
    expect(out).toContain(`Created: ${wtPath}`);

    // The branch starts at the base and is checked out in the new worktree.
    expect(git(["rev-parse", "refs/heads/feature/login"]).trim()).toBe(
      git(["rev-parse", "master"]).trim(),
    );
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("feature/login");
    expect(git(["worktree", "list", "--porcelain"])).toContain(wtPath);
  });

  test("configures .githooks in the new worktree when the repo has one", async () => {
    const hooksDir = join(root, ".githooks");
    mkdirSync(hooksDir);
    const wtPath = resolve(config.treeDir, "hooked");
    const out = await runExpectSuccess(() => execute(["hooked", "master"], config));
    expect(out).toContain("hooks configured");
    expect(git(["config", "--get", "core.hooksPath"], wtPath).trim()).toBe(hooksDir);
  });

  test("enables commit signing when the agent key has a usable secret", async () => {
    config.agentGpgKeyId = "ABCDEF0123456789";
    await withStubGpg(async () => {
      const wtPath = resolve(config.treeDir, "signed");
      const out = await runExpectSuccess(() => execute(["signed", "master"], config));
      expect(out).toContain("GPG signing enabled (key: ABCDEF01...)");
      expect(git(["config", "--get", "commit.gpgsign"], wtPath).trim()).toBe("true");
      expect(git(["config", "--get", "user.signingkey"], wtPath).trim()).toBe("ABCDEF0123456789");
    });
  });

  test("leaves the new worktree unsigned when gpg cannot find the key", async () => {
    config.agentGpgKeyId = "ABCDEF0123456789";
    await withStubGpg(async () => {
      const wtPath = resolve(config.treeDir, "unsigned");
      const out = await runExpectSuccess(() => execute(["unsigned", "master"], config));
      expect(out).not.toContain("GPG signing enabled");
      expect(gitExit(["config", "--get", "commit.gpgsign"], wtPath)).not.toBe(0);
    }, 1);
  });
});

describe("new-branch failure paths", () => {
  test("keeps an existing directory at the worktree path instead of clobbering it", async () => {
    const wtPath = resolve(config.treeDir, "taken");
    mkdirSync(wtPath, { recursive: true });
    writeFileSync(join(wtPath, "user-file.txt"), "mine\n");
    const out = await runExpectSuccess(() => execute(["taken", "master"], config));
    expect(out).toContain(`worktree already exists: ${wtPath}`);
    expect(existsSync(join(wtPath, "user-file.txt"))).toBe(true);
    // The guard runs before the branch is created.
    expect(gitExit(["rev-parse", "--verify", "refs/heads/taken"])).not.toBe(0);
  });

  test("surfaces git's error and creates no branch when the base is not a commit", async () => {
    const treeSha = git(["rev-parse", "master^{tree}"]).trim();
    const out = await runExpectExit1(() => execute(["tree-based", treeSha], config));
    expect(out).toContain("worktree add failed (exit 128)");
    expect(out).toContain("is a tree, not a commit");
    expect(gitExit(["rev-parse", "--verify", "refs/heads/tree-based"])).not.toBe(0);
    expect(existsSync(resolve(config.treeDir, "tree-based"))).toBe(false);
  });
});
