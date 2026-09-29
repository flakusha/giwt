// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt rebase`.
 *
 * Two families of behavior:
 *
 * 1. Target validation (BUG 23751b8). The guard checked only the source
 *    branch and derived the default target from the *main checkout's*
 *    current branch, so a detached checkout silently rebased onto the
 *    literal "master" and a protected target was never refused. Both
 *    refusals must land before any git mutation.
 * 2. No-op detection (BUG 8dc674e). Rebasing onto an already-contained target
 *    is not a no-op - it rewrites and re-signs the whole tail - so the plan
 *    reconciler short-circuits and leaves HEAD byte-identical.
 *
 * Strategy: a real scratch repo with a real linked worktree at
 * treeDir/<branch>, so findWorktree() resolves and `git rebase` really runs.
 * Child git is spawned with isolatedGitEnv() so ambient GIT_* hook context
 * cannot poison the fixture. Every test owns its own mkdtemp() checkout,
 * removed in afterEach.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebaseWithPlanReconciliation } from "../plan/reconcile-conflicts";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { rebase } from "./rebase";

const TARGET = "integration";

let root: string;
let wtPath: string;
const temps: string[] = [];

function git(args: string[], cwd: string = root): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** Exit code of a git probe that is expected to fail (containment checks). */
function gitExit(args: string[], cwd: string = root): number {
  return Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  }).exitCode;
}

/**
 * main + non-protected target `integration` + `feature` forked off the base
 * commit, with `feature` checked out in a linked worktree under treeDir/.
 * `integration` is still contained in `feature` until divergeTarget() runs.
 */
function makeRepo(): WorktreeConfig {
  root = mkdtempSync(join(tmpdir(), "giwt-rebase-"));
  temps.push(root);
  git(["init", "-q", "-b", "main", root]);
  git(["config", "user.email", "giwt-test@localhost"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "base.txt"), "base\n");
  git(["add", "base.txt"]);
  git(["commit", "-qm", "base"]);
  git(["branch", TARGET]);
  git(["checkout", "-qb", "feature"]);
  writeFileSync(join(root, "feature.txt"), "feature\n");
  git(["add", "feature.txt"]);
  git(["commit", "-qm", "feature"]);
  git(["checkout", "-q", "main"]);
  const treeDir = join(root, "tree");
  mkdirSync(treeDir, { recursive: true });
  wtPath = join(treeDir, branchToPath("feature"));
  git(["worktree", "add", wtPath, "feature"]);
  return { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
}

/** Move the target ahead of the feature fork so the two genuinely diverge. */
function divergeTarget(): void {
  git(["checkout", "-q", TARGET]);
  writeFileSync(join(root, "target.txt"), "target\n");
  git(["add", "target.txt"]);
  git(["commit", "-qm", "target change"]);
  git(["checkout", "-q", "main"]);
}

/**
 * Diverge both sides on the SAME tracked file so a real content conflict is
 * guaranteed: the target rewrites base.txt, the feature worktree (which the
 * command will rebase) rewrites the same lines differently and commits. A file
 * only one side ever had cannot conflict, so both edits must exist.
 */
function conflictBothSides(): void {
  git(["checkout", "-q", TARGET]);
  writeFileSync(join(root, "base.txt"), "target side\n");
  git(["add", "base.txt"]);
  git(["commit", "-qm", "target rewrites base"]);
  git(["checkout", "-q", "main"]);
  writeFileSync(join(wtPath, "base.txt"), "feature side\n");
  git(["add", "base.txt"], wtPath);
  git(["commit", "-qm", "feature rewrites base"], wtPath);
}

/** Settings variant whose default target is the non-protected TARGET branch. */
function rootIsTarget(config: WorktreeConfig): WorktreeConfig {
  return {
    ...config,
    settings: {
      ...config.settings,
      branches: { ...config.settings.branches, root: TARGET },
    },
  };
}

beforeEach(() => {
  setLogLevel("info");
});

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Capture log()/raw() traffic and replace process.exit with a throwing stub.
 * The command runs synchronously up to the exit, so the rejection carries the
 * stub error while the captured output is already complete.
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

/** Run the command; it must refuse via process.exit(1). Returns all output. */
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

/** Run the command to completion; returns everything log()/raw() wrote. */
async function runExpectSuccess(runner: () => Promise<void>): Promise<string> {
  const spies = installSpies();
  try {
    await runner();
    return spies.collect();
  } finally {
    spies.restore();
  }
}

describe("rebase target validation (23751b8)", () => {
  test("refuses a protected target without touching the branch", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", "feature"]).trim();

    // 'main' is protected but the source branch is not, so the refusal can
    // only come from the target guard.
    const out = await runExpectExit1(() => rebase(["feature", "main"], config));
    expect(out).toContain("cannot rebase onto protected branch 'main'");
    expect(git(["rev-parse", "feature"]).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });

  test("refuses a self-rebase without touching the branch", async () => {
    const config = makeRepo();
    const before = git(["rev-parse", "feature"]).trim();

    const out = await runExpectExit1(() => rebase(["feature", "feature"], config));
    expect(out).toContain("cannot rebase 'feature' onto itself");
    expect(git(["rev-parse", "feature"]).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });

  test("default target comes from settings, not the main checkout", async () => {
    const config = makeRepo();
    divergeTarget();
    // Detached: the old getRootBranch(repoRoot) fallback resolved to the
    // literal "master", a ref this repo does not have.
    git(["checkout", "-q", "--detach"]);

    const out = await runExpectSuccess(() => rebase(["feature"], rootIsTarget(config)));
    expect(out).toContain(`Rebased 'feature' onto '${TARGET}'`);
    expect(gitExit(["merge-base", "--is-ancestor", TARGET, "HEAD"], wtPath)).toBe(0);
  });
});

describe("rebase happy path", () => {
  test("rebases a diverged feature branch onto a non-protected target", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", "feature"]).trim();

    const out = await runExpectSuccess(() => rebase(["feature", TARGET], config));
    expect(out).toContain(`Rebased 'feature' onto '${TARGET}'`);
    // A real replay: HEAD moved, target is now contained, nothing left dirty.
    expect(git(["rev-parse", "feature"]).trim()).not.toBe(before);
    expect(gitExit(["merge-base", "--is-ancestor", TARGET, "HEAD"], wtPath)).toBe(0);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });
});

describe("rebase no-op detection (8dc674e)", () => {
  test("a contained target leaves HEAD byte-identical", () => {
    const config = makeRepo();
    const before = git(["rev-parse", "HEAD"], wtPath).trim();

    const result = rebaseWithPlanReconciliation(
      wtPath,
      TARGET,
      config.settings.paths.planDir,
      config.settings.paths.tickets,
    );
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([]);
    // git rebase would emit its own "Current branch ... is up to date" line;
    // its absence is what proves the rebase was never spawned.
    expect(result.output).not.toContain("Current branch");
    expect(result.output).toContain("contained in HEAD");
    expect(git(["rev-parse", "HEAD"], wtPath).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });
});

describe("rebase refusals before any git mutation", () => {
  test("refuses a missing branch name with the usage line", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", "feature"]).trim();

    const out = await runExpectExit1(() => rebase([], config));
    expect(out).toContain("branch name required");
    expect(out).toContain("Usage: giwt rebase <branch> [onto]");
    // No ref moved: the guard fired before any git call.
    expect(git(["rev-parse", "feature"]).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });

  test("refuses a protected source branch and leaves it alone", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", "main"]).trim();

    // 'main' is protected and is also the default target, so only the source
    // guard can produce this message.
    const out = await runExpectExit1(() => rebase(["main"], config));
    expect(out).toContain("cannot rebase protected branch 'main'");
    expect(out).not.toContain("no worktree found");
    expect(git(["rev-parse", "main"]).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });

  test("refuses a branch that has no registered worktree", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", TARGET]).trim();

    // TARGET exists in the repo but nothing ever checked it out, so
    // findWorktree() returns null. TARGET is the onto arg, so the target
    // guard, the self-rebase guard and the protected guard all pass first.
    const out = await runExpectExit1(() => rebase([TARGET, TARGET + "-base"], config));
    expect(out).toContain(`no worktree found for branch '${TARGET}'`);
    expect(git(["rev-parse", TARGET]).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });

  test("refuses a target ref that does not exist", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", "feature"]).trim();

    const out = await runExpectExit1(() => rebase(["feature", "no-such-ref"], config));
    expect(out).toContain("target branch 'no-such-ref' does not exist");
    expect(git(["rev-parse", "feature"]).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");
  });
});

describe("rebase dirty-worktree guard", () => {
  test("refuses a worktree with an unstaged edit", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", "feature"]).trim();
    writeFileSync(join(wtPath, "base.txt"), "uncommitted\n");
    // Only the worktree side is dirty, so `git diff --quiet` is what fails.
    expect(gitExit(["diff", "--quiet"], wtPath)).not.toBe(0);
    expect(gitExit(["diff", "--cached", "--quiet"], wtPath)).toBe(0);

    const out = await runExpectExit1(() => rebase(["feature", TARGET], config));
    expect(out).toContain("uncommitted changes in worktree 'feature'");
    expect(git(["rev-parse", "feature"]).trim()).toBe(before);
    // The edit survives untouched: no rebase ran, and the remedy is the
    // user's own dirty file, not a conflict we created.
    // Leading space = the porcelain XY column says "not staged"; trimEnd only
    // drops the trailing newline so that column survives the comparison.
    expect(git(["status", "--porcelain"], wtPath).trimEnd()).toBe(" M base.txt");
    expect(gitExit(["diff", "--name-only", "--diff-filter=U"], wtPath)).toBe(0);
  });

  test("refuses a worktree with a staged-only edit", async () => {
    const config = makeRepo();
    divergeTarget();
    const before = git(["rev-parse", "feature"]).trim();
    writeFileSync(join(wtPath, "base.txt"), "staged only\n");
    git(["add", "base.txt"], wtPath);
    // The other half of the guard: the index is dirty but the worktree is
    // not, so only `git diff --cached --quiet` fails.
    expect(gitExit(["diff", "--quiet"], wtPath)).toBe(0);
    expect(gitExit(["diff", "--cached", "--quiet"], wtPath)).not.toBe(0);

    const out = await runExpectExit1(() => rebase(["feature", TARGET], config));
    expect(out).toContain("uncommitted changes in worktree 'feature'");
    expect(git(["rev-parse", "feature"]).trim()).toBe(before);
    expect(git(["status", "--porcelain"], wtPath).trimEnd()).toBe("M  base.txt");
  });
});

describe("rebase conflict reporting", () => {
  test("a real conflicting rebase exits 1 with the continue/abort remedy", async () => {
    const config = makeRepo();
    divergeTarget();
    conflictBothSides();
    // base.txt diverged on both sides, so a replay cannot apply cleanly.
    expect(gitExit(["merge-base", "--is-ancestor", TARGET, "HEAD"], wtPath)).not.toBe(0);
    expect(git(["status", "--porcelain"], wtPath)).toBe("");

    const out = await runExpectExit1(() => rebase(["feature", TARGET], config));
    expect(out).toContain("CONFLICT");
    expect(out).toContain(`rebase failed — resolve conflicts in ${wtPath}`);
    expect(out).toContain(`Then: cd ${wtPath} && git rebase --continue`);
    expect(out).toContain(`Or:   cd ${wtPath} && git rebase --abort`);
    // The remedy is real advice, not boilerplate: the rebase is genuinely
    // mid-flight with an unresolved path, so --continue would do something.
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wtPath).trim()).toBe("HEAD");
    expect(git(["diff", "--name-only", "--diff-filter=U"], wtPath)).toContain("base.txt");
  });
});
