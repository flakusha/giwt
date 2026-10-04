// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Strict-superset conflict auto-resolution.
 *
 * When a rebase (or the finalize merge path that shares
 * rebaseWithPlanReconciliation) stops on an unmerged file whose two sides
 * form a strict superset relationship - every non-empty trimmed line of the
 * smaller side appears in the larger side, in order - the larger side is a
 * safe automatic resolution: it already contains everything both sides
 * wrote. Overlapping edits (neither side contains the other) and identical
 * sides (ambiguous which "wins") stay for manual resolution.
 *
 * Unit tests cover the classifier directly; fixture repos cover the
 * auto-resolve pass through rebaseWithPlanReconciliation and through the
 * `giwt rebase` command entry (warn log, summary line, completed rebase).
 * Every child git runs with isolatedGitEnv() so ambient GIT_* hook context
 * cannot poison the fixtures; every test owns one fresh mkdtemp() checkout,
 * removed in afterEach.
 */

import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebase } from "../commands/rebase";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import {
  type RebaseResult,
  rebaseWithPlanReconciliation,
  strictSupersetSide,
} from "./reconcile-conflicts";

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedGitEnv(), GIT_EDITOR: "true" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${
        args.join(" ")
      } failed (${result.exitCode}): ${result.stderr.toString()} ${result.stdout.toString()}`,
    );
  }
  return result.stdout.toString();
}

/** Capture log()/raw() traffic (stdout + stderr) for the duration of `run`. */
async function capture(run: () => Promise<void> | void): Promise<string> {
  const outSpy = spyOn(process.stdout, "write");
  const errSpy = spyOn(process.stderr, "write");
  outSpy.mockImplementation(() => true);
  errSpy.mockImplementation(() => true);
  try {
    await run();
    return [
      ...outSpy.mock.calls.map((args) => String(args[0])),
      ...errSpy.mock.calls.map((args) => String(args[0])),
    ].join("");
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

interface Fixture {
  root: string;
  cleanup: () => void;
}

/** Plain repo on `main` with `shared.txt` at the merge base; no plan files,
 *  so the generated-plan reconciler is inert and only the superset pass can
 *  act. `integration` and `feature` diverge by appending to the same file. */
function makeRepo(): Fixture {
  const root = mkdtempSync(join(scratchRoot(), "giwt-superset-"));
  const cleanup = (): void => rmSync(root, { recursive: true, force: true });
  try {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "giwt-test@localhost");
    git(root, "config", "user.name", "giwt test");
    git(root, "config", "commit.gpgsign", "false");
    writeFileSync(join(root, "shared.txt"), "a\n");
    writeFileSync(join(root, "README.md"), "fixture\n");
    git(root, "add", "shared.txt", "README.md");
    git(root, "commit", "-qm", "base");
    return { root, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** `integration` appends `integrationLines`, `feature` appends
 *  `featureLines`; both sides touch the append point after the shared base
 *  line, so the rebase replay genuinely conflicts. Leaves HEAD on main. */
function diverge(root: string, integrationLines: string[], featureLines: string[]): void {
  git(root, "checkout", "-qb", "integration");
  writeFileSync(join(root, "shared.txt"), `a\n${integrationLines.join("\n")}\n`);
  git(root, "add", "shared.txt");
  git(root, "commit", "-qm", "integration appends");
  git(root, "checkout", "-q", "main");
  git(root, "checkout", "-qb", "feature");
  writeFileSync(join(root, "shared.txt"), `a\n${featureLines.join("\n")}\n`);
  git(root, "add", "shared.txt");
  git(root, "commit", "-qm", "feature appends");
  git(root, "checkout", "-q", "main");
}

describe("strictSupersetSide", () => {
  test("picks the side that appended the extra lines", () => {
    expect(strictSupersetSide("a\nshared\n", "a\nshared\nextra\n")).toBe("theirs");
    expect(strictSupersetSide("a\nshared\nextra\n", "a\nshared\n")).toBe("ours");
  });

  test("a non-contiguous smaller side is still contained", () => {
    expect(strictSupersetSide("one\ntwo\nthree\n", "two\n")).toBe("ours");
    expect(strictSupersetSide("one\ntwo\nthree\n", "one\nthree\n")).toBe("ours");
  });

  test("overlapping edits stay for manual resolution", () => {
    expect(strictSupersetSide("a2\n", "a\nshared\n")).toBe(null);
    expect(strictSupersetSide("a\nb\n", "a\nc\n")).toBe(null);
  });

  test("identical sides are ambiguous, not a superset", () => {
    expect(strictSupersetSide("x\ny\n", "x\ny\n")).toBe(null);
  });

  test("trim and blank lines never create a false superset", () => {
    expect(strictSupersetSide("  a \n\n", "a\n")).toBe(null);
    expect(strictSupersetSide("a\n", "a\n\n  \n")).toBe(null);
  });

  test("an empty side is contained by any content side", () => {
    expect(strictSupersetSide("", "a\n")).toBe("theirs");
    expect(strictSupersetSide("a\n", "")).toBe("ours");
    expect(strictSupersetSide("", "")).toBe(null);
  });
});

describe("rebaseWithPlanReconciliation strict-superset auto-resolve", () => {
  beforeEach(() => {
    setLogLevel("info");
  });

  test("appended-only feature side resolves and the rebase completes", async () => {
    const fixtureValue = makeRepo();
    const { root } = fixtureValue;
    try {
      diverge(root, ["shared"], ["shared", "extra"]);
      git(root, "checkout", "-q", "feature");

      let out = "";
      let result!: RebaseResult;
      out = await capture(() => {
        result = rebaseWithPlanReconciliation(root, "integration", "plan", "plan/tickets");
      });

      expect(result.exitCode).toBe(0);
      expect(result.autoResolved).toEqual(["shared.txt"]);
      // The superset side won: both appends survive.
      expect(readFileSync(join(root, "shared.txt"), "utf8")).toBe("a\nshared\nextra\n");
      expect(out).toContain("auto-resolved shared.txt: theirs side is a strict superset");
      expect(git(root, "status", "--porcelain")).toBe("");
      expect(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("feature");
      expect(git(root, "merge-base", "--is-ancestor", "integration", "HEAD")).toBe("");
    } finally {
      fixtureValue.cleanup();
    }
  });

  test("resolves the other direction too (rebase-side superset)", async () => {
    const fixtureValue = makeRepo();
    const { root } = fixtureValue;
    try {
      // integration appended both lines, feature only one: during the replay
      // ours (the new base) is the strict superset.
      diverge(root, ["shared", "extra"], ["shared"]);
      git(root, "checkout", "-q", "feature");

      let out = "";
      let result!: RebaseResult;
      out = await capture(() => {
        result = rebaseWithPlanReconciliation(root, "integration", "plan", "plan/tickets");
      });

      expect(result.exitCode).toBe(0);
      expect(result.autoResolved).toEqual(["shared.txt"]);
      expect(readFileSync(join(root, "shared.txt"), "utf8")).toBe("a\nshared\nextra\n");
      expect(out).toContain("auto-resolved shared.txt: ours side is a strict superset");
    } finally {
      fixtureValue.cleanup();
    }
  });

  test("overlapping edits still stop the rebase unresolved", async () => {
    const fixtureValue = makeRepo();
    const { root } = fixtureValue;
    try {
      git(root, "checkout", "-qb", "integration");
      writeFileSync(join(root, "shared.txt"), "integration side\n");
      git(root, "add", "shared.txt");
      git(root, "commit", "-qm", "integration rewrites");
      git(root, "checkout", "-q", "main");
      git(root, "checkout", "-qb", "feature");
      writeFileSync(join(root, "shared.txt"), "feature side\n");
      git(root, "add", "shared.txt");
      git(root, "commit", "-qm", "feature rewrites");
      git(root, "checkout", "-q", "main");
      git(root, "checkout", "-q", "feature");

      let out = "";
      let result!: RebaseResult;
      out = await capture(() => {
        result = rebaseWithPlanReconciliation(root, "integration", "plan", "plan/tickets");
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.autoResolved).toEqual([]);
      expect(out).not.toContain("auto-resolved");
      expect(git(root, "diff", "--name-only", "--diff-filter=U")).toContain("shared.txt");
      // Rebase stays mid-flight for manual resolution.
      expect(git(root, "status", "--porcelain")).toContain("UU shared.txt");
    } finally {
      fixtureValue.cleanup();
    }
  });
});

describe("giwt rebase command reports auto-resolutions", () => {
  beforeEach(() => {
    setLogLevel("info");
  });

  test("completes the rebase and logs the per-file warn plus summary line", async () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-superset-cmd-"));
    const cleanup = (): void => rmSync(root, { recursive: true, force: true });
    try {
      git(root, "init", "-q", "-b", "main");
      git(root, "config", "user.email", "giwt-test@localhost");
      git(root, "config", "user.name", "giwt test");
      git(root, "config", "commit.gpgsign", "false");
      writeFileSync(join(root, "shared.txt"), "a\n");
      git(root, "add", "shared.txt");
      git(root, "commit", "-qm", "base");
      git(root, "branch", "integration");

      // Feature works in a linked worktree (clean at command start), commits
      // the appended-only side there.
      const treeDir = join(root, "tree");
      mkdirSync(treeDir, { recursive: true });
      const wtPath = join(treeDir, branchToPath("feature"));
      git(root, "worktree", "add", wtPath, "-b", "feature");
      writeFileSync(join(wtPath, "shared.txt"), "a\nshared\nextra\n");
      git(wtPath, "add", "shared.txt");
      git(wtPath, "commit", "-qm", "feature appends");

      // Integration appends only "shared" - the feature side is its superset.
      git(root, "checkout", "-q", "integration");
      writeFileSync(join(root, "shared.txt"), "a\nshared\n");
      git(root, "add", "shared.txt");
      git(root, "commit", "-qm", "integration appends");
      git(root, "checkout", "-q", "main");

      const config: WorktreeConfig = {
        repoRoot: root,
        worktreeRoot: root,
        treeDir,
        settings: DEFAULT_SETTINGS,
      };

      const out = await capture(() => rebase(["feature", "integration"], config));

      expect(out).toContain("auto-resolved shared.txt: theirs side is a strict superset");
      expect(out).toContain("Auto-resolved 1 conflict(s) by strict superset: shared.txt");
      expect(out).toContain("Rebased 'feature' onto 'integration'");
      expect(git(wtPath, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("feature");
      expect(readFileSync(join(wtPath, "shared.txt"), "utf8")).toBe("a\nshared\nextra\n");
    } finally {
      cleanup();
    }
  });
});
