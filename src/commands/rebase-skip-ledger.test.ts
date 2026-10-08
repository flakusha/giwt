// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the rebase → skip-ledger wiring (FEAT-rebase-skip-decisions-
 * are-not-recorded): a rebase that silently drops commits appends one
 * durable record per skip, the records survive `giwt clean` and run-dir
 * pruning, and readback lists them in replay order.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readSkips, skipsPath } from "../history/skips";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { beginRun, finishActiveRun } from "../utils/runlog";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { clean } from "./clean";
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

function makeRepo(): WorktreeConfig {
  root = mkdtempSync(join(scratchRoot(), "giwt-rebase-skip-"));
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
  git(["checkout", "-q", "main"]);
  const treeDir = join(root, "tree");
  mkdirSync(treeDir, { recursive: true });
  wtPath = join(treeDir, branchToPath("feature"));
  git(["worktree", "add", wtPath, "feature"]);
  return { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
}

/** Runs scratchpad root — mirrors runlog's private runsRoot(). */
function runsRoot(config: WorktreeConfig): string {
  return resolve(config.repoRoot, config.settings.paths.runlog, "runs");
}

/** Settings variant whose default target is the non-protected TARGET. */
function rootIsTarget(config: WorktreeConfig): WorktreeConfig {
  return {
    ...config,
    settings: {
      ...config.settings,
      branches: { ...config.settings.branches, root: TARGET },
    },
  };
}

function capture(): { collect: () => string; restore: () => void; } {
  const outSpy = spyOn(process.stdout, "write");
  const errSpy = spyOn(process.stderr, "write");
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
    },
  };
}

beforeEach(() => {
  setLogLevel("info");
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("rebase skip ledger (FEAT-rebase-skip-decisions-are-not-recorded)", () => {
  test("a dropped duplicate writes a durable record with detected reason and operator note", async () => {
    const config = makeRepo();
    // Diverge: target and feature both add the SAME change.
    git(["checkout", "-q", TARGET]);
    writeFileSync(join(root, "shared.txt"), "shared\n");
    git(["add", "shared.txt"]);
    git(["commit", "-qm", "shared change on target"]);
    const twin = git(["rev-parse", TARGET]).trim();
    git(["checkout", "-q", "main"]);
    writeFileSync(join(wtPath, "shared.txt"), "shared\n");
    git(["add", "shared.txt"], wtPath);
    git(["commit", "-qm", "shared change on feature"], wtPath);
    const preHead = git(["rev-parse", "feature"]).trim();

    const cap = capture();
    try {
      await rebase(
        ["feature", "--skip-note", "upstream duplicate, safe to drop"],
        rootIsTarget(config),
      );
      const out = cap.collect();
      expect(out).toContain("skipped 1 commit(s)");
    } finally {
      cap.restore();
    }

    const records = readSkips(config);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.branch).toBe("feature");
    expect(record.onto).toBe(TARGET);
    expect(record.preHead).toBe(preHead);
    expect(record.subject).toBe("shared change on feature");
    expect(record.patchId).toMatch(/^[0-9a-f]{40}$/);
    expect(record.reason.detected).toBe("duplicate");
    expect(record.reason.note).toBe("upstream duplicate, safe to drop");
    expect(record.twins).toContain(twin);
    expect(record.sha).toBe(preHead);
    // The ledger lives in the repo runlog area, not inside a run dir.
    expect(existsSync(skipsPath(config))).toBe(true);
    expect(skipsPath(config).startsWith(runsRoot(config))).toBe(false);
  });

  test("a clean rebase writes no skip records", async () => {
    const config = makeRepo();
    git(["checkout", "-q", TARGET]);
    writeFileSync(join(root, "target.txt"), "target\n");
    git(["add", "target.txt"]);
    git(["commit", "-qm", "target change"]);
    git(["checkout", "-q", "main"]);
    writeFileSync(join(wtPath, "feat.txt"), "feat\n");
    git(["add", "feat.txt"], wtPath);
    git(["commit", "-qm", "fresh work"], wtPath);

    const cap = capture();
    try {
      await rebase(["feature"], rootIsTarget(config));
      expect(cap.collect()).not.toContain("skipped");
    } finally {
      cap.restore();
    }
    expect(readSkips(config)).toHaveLength(0);
  });

  test("a start-empty commit survives the replay and is not recorded as a skip", async () => {
    const config = makeRepo();
    git(["checkout", "-q", TARGET]);
    writeFileSync(join(root, "target.txt"), "target\n");
    git(["add", "target.txt"]);
    git(["commit", "-qm", "target change"]);
    git(["checkout", "-q", "main"]);
    git(["commit", "-q", "--allow-empty", "-m", "empty marker"], wtPath);

    const cap = capture();
    try {
      await rebase(["feature"], rootIsTarget(config));
      expect(cap.collect()).not.toContain("skipped");
    } finally {
      cap.restore();
    }
    expect(readSkips(config)).toHaveLength(0);
    // The empty commit itself survived the replay.
    expect(git(["log", "--format=%s", `${TARGET}..feature`], wtPath)).toContain("empty marker");
  });

  test("records survive `giwt clean --apply` and run-dir pruning", async () => {
    const config = makeRepo();
    git(["checkout", "-q", TARGET]);
    writeFileSync(join(root, "shared.txt"), "shared\n");
    git(["add", "shared.txt"]);
    git(["commit", "-qm", "shared change on target"]);
    git(["checkout", "-q", "main"]);
    writeFileSync(join(wtPath, "shared.txt"), "shared\n");
    git(["add", "shared.txt"], wtPath);
    git(["commit", "-qm", "shared change on feature"], wtPath);

    const cap = capture();
    try {
      await rebase(["feature"], rootIsTarget(config));
    } finally {
      cap.restore();
    }
    expect(readSkips(config)).toHaveLength(1);

    // giwt clean prunes scratch classes only; skips.jsonl is none of them.
    const cleanCap = capture();
    try {
      await clean(["--apply"], config);
    } finally {
      cleanCap.restore();
    }
    expect(existsSync(skipsPath(config))).toBe(true);
    expect(readSkips(config)).toHaveLength(1);

    // runlog.max_runs prunes run DIRS; the ledger sits outside runs/.
    const tight: WorktreeConfig = {
      ...config,
      settings: { ...config.settings, runlog: { maxRuns: 2 } },
    };
    for (let i = 0; i < 4; i++) {
      // Unique cmd per iteration: run ids are <ts>-<pid>-<cmd>, so a
      // repeated cmd inside the same second collides on the same dir.
      const rec = beginRun(tight, `probe-${i}`, [], null, "feature");
      expect(rec).not.toBeNull();
      finishActiveRun(0);
    }
    expect(readdirSync(runsRoot(tight)).length).toBeLessThanOrEqual(2);
    expect(readSkips(tight)).toHaveLength(1);
  });

  test("--skip-note without a value refuses with the usage line", async () => {
    const config = makeRepo();
    const before = git(["rev-parse", "feature"]).trim();
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        throw new Error(`__exit__:${code}`);
      }) as typeof process.exit,
    );
    const cap = capture();
    try {
      let aborted = false;
      try {
        await rebase(["feature", "--skip-note"], config);
      } catch (err) {
        expect((err as Error).message).toBe("__exit__:1");
        aborted = true;
      }
      expect(aborted).toBe(true);
      expect(cap.collect()).toContain("--skip-note requires a reason");
    } finally {
      exitSpy.mockRestore();
      cap.restore();
    }
    expect(git(["rev-parse", "feature"]).trim()).toBe(before);
  });
});
