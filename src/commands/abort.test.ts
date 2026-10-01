// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orchestrator tests for `abort` (the manual finalize-recovery command).
 *
 * The pure helpers are covered by abort-orphan-marker.test.ts; these tests
 * drive the real flow against scratch git repos: in-progress merge abort,
 * orphan rebase breadcrumb removal, finalize-stash restoration, lockfile
 * removal, dry-run guarantees, and the final state report.
 *
 * Child git is spawned with isolatedGitEnv() so ambient GIT_* hook context
 * (GIT_DIR/GIT_INDEX_FILE, relative) cannot poison the fixtures.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { abort, LOCK_FILENAME, removeLockfile } from "./abort";

let root: string;
const temps: string[] = [];

function git(args: string[], cwd: string = root): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  return result.stdout.toString() + result.stderr.toString();
}

function makeRepo(): WorktreeConfig {
  root = mkdtempSync(join(tmpdir(), "giwt-abort-"));
  temps.push(root);
  Bun.spawnSync(["git", "init", "-q", "-b", "main", root], { env: isolatedGitEnv() });
  git(["config", "user.email", "giwt-test@localhost"]);
  git(["config", "user.name", "giwt test"]);
  writeFileSync(join(root, "a.txt"), "base\n");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "base"]);
  return { repoRoot: root, worktreeRoot: root, treeDir: root, settings: DEFAULT_SETTINGS };
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

/**
 * Run abort() expecting a non-zero process.exit; returns output + code via
 * the repo-wide `__exit:N` sentinel convention (commit-protected.test.ts).
 * Owns nothing beyond capture()'s spies — both restored in `finally`.
 */
async function abortExitingNonZero(cfg: WorktreeConfig): Promise<{ out: string; code: number; }> {
  const cap = capture();
  const exit = spyOn(process, "exit").mockImplementation(
    ((code?: number) => {
      throw new Error(`__exit:${code ?? 0}`);
    }) as never,
  );
  try {
    await abort([], cfg);
    throw new Error("expected abort() to exit non-zero but it returned");
  } catch (err) {
    const message = (err as Error).message;
    if (!message.startsWith("__exit:")) throw err;
    return { out: cap.text(), code: Number(message.slice("__exit:".length)) };
  } finally {
    exit.mockRestore();
    cap.restore();
  }
}

/** Build a conflicted merge in the fixture repo (MERGE_HEAD present). */
function startConflictedMerge(): void {
  git(["checkout", "-q", "-b", "feature"]);
  writeFileSync(join(root, "a.txt"), "feature\n");
  git(["commit", "-aqm", "feature change"]);
  git(["checkout", "-q", "main"]);
  writeFileSync(join(root, "a.txt"), "main\n");
  git(["commit", "-aqm", "main change"]);
  git(["merge", "feature"]);
}

/** Build a conflicted cherry-pick in the fixture repo (CHERRY_PICK_HEAD). */
function startConflictedCherryPick(): void {
  git(["checkout", "-q", "-b", "pick-source"]);
  writeFileSync(join(root, "a.txt"), "picked\n");
  git(["commit", "-aqm", "picked change"]);
  const picked = git(["rev-parse", "HEAD"]).trim();
  git(["checkout", "-q", "main"]);
  writeFileSync(join(root, "a.txt"), "main line\n");
  git(["commit", "-aqm", "main change"]);
  git(["cherry-pick", picked]);
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("abort orchestrator", () => {
  test("clean repo reports no stashes and no lockfile", async () => {
    const cfg = makeRepo();
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("No leftover finalize stashes");
    expect(out).toContain("No lockfile present");
    expect(out).toContain("Abort complete");
    expect(out).toContain("Branch: main");
  });

  test("dry-run mutates nothing but reports what would happen", async () => {
    const cfg = makeRepo();
    // Stash first: a conflicted index blocks stash-with-pathspec.
    writeFileSync(join(root, "stash-me.txt"), "dirty\n");
    git(["stash", "push", "-q", "-u", "-m", "worktree-finalize-1", "stash-me.txt"]);
    startConflictedMerge();
    writeFileSync(join(root, LOCK_FILENAME), "pid=1\n");

    const cap = capture();
    try {
      await abort(["--dry-run"], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("DRY RUN");
    expect(out).toContain("Found MERGE_HEAD");
    expect(out).toContain("Found 1 finalize stash(es)");
    expect(out).toContain("lockfile");
    expect(out).toContain("DRY RUN complete");
    // No mutations: merge still in progress, lockfile and stash survive.
    expect(existsSync(join(root, ".git", "MERGE_HEAD"))).toBe(true);
    expect(existsSync(join(root, LOCK_FILENAME))).toBe(true);
    expect(git(["stash", "list"])).toContain("worktree-finalize-1");
  });

  test("aborts an in-progress merge", async () => {
    const cfg = makeRepo();
    startConflictedMerge();
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("Found MERGE_HEAD — aborting in-progress merge");
    expect(out).toContain("aborted in-progress merge");
    expect(existsSync(join(root, ".git", "MERGE_HEAD"))).toBe(false);
  });

  test("removes an orphan REBASE_HEAD breadcrumb instead of calling rebase --abort", async () => {
    const cfg = makeRepo();
    // Breadcrumb without its state dirs: the rebase already concluded.
    writeFileSync(join(root, ".git", "REBASE_HEAD"), `${git(["rev-parse", "HEAD"]).trim()}\n`);
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("Found orphan REBASE_HEAD");
    expect(out).toContain("removed orphan rebase marker");
    expect(existsSync(join(root, ".git", "REBASE_HEAD"))).toBe(false);
  });

  test("restores a leftover finalize stash and removes the lockfile", async () => {
    const cfg = makeRepo();
    writeFileSync(join(root, "stash-me.txt"), "dirty\n");
    git(["stash", "push", "-q", "-u", "-m", "worktree-finalize-7", "stash-me.txt"]);
    writeFileSync(join(root, LOCK_FILENAME), "pid=1\n");

    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("Found 1 finalize stash(es)");
    expect(out).toContain("restored stash@{0}");
    // Clean-tree pop (the normal crash-recovery shape) proceeds, but is
    // warned about up front and carries a dropped-sha undo hint.
    expect(out).toContain("CLEAN tree");
    expect(out).toContain("undo with 'git stash apply");
    expect(out).toContain("lockfile removed");
    // The stashed file came back and the lockfile is gone.
    expect(existsSync(join(root, "stash-me.txt"))).toBe(true);
    expect(existsSync(join(root, LOCK_FILENAME))).toBe(false);
    expect(readdirSync(root).includes(LOCK_FILENAME)).toBe(false);
  });

  test("leaves user-authored stashes untouched", async () => {
    const cfg = makeRepo();
    writeFileSync(join(root, "mine.txt"), "user work\n");
    git(["stash", "push", "-q", "-u", "-m", "my own stash", "mine.txt"]);
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("No leftover finalize stashes");
    expect(git(["stash", "list"])).toContain("my own stash");
  });

  test("pop conflict leaves unrelated tracked and staged work byte-identical", async () => {
    // BUG-abort-hard-resets-dev… + loop-lore BUG-giwt-abort-runs-unscoped…:
    // the old conflict branch ran an unscoped `reset --hard HEAD` that
    // destroyed every unrelated tracked modification and staged entry.
    const cfg = makeRepo();
    writeFileSync(join(root, "unrelated.txt"), "base\n");
    git(["add", "unrelated.txt"]);
    git(["commit", "-qm", "add unrelated"]);
    // Finalize-style stash touching a.txt (label-anchored, tracked only).
    writeFileSync(join(root, "a.txt"), "stashed\n");
    git(["stash", "push", "-q", "-m", "worktree-finalize-2k5z", "a.txt"]);
    // Move HEAD so the pop genuinely three-way-conflicts on a.txt.
    writeFileSync(join(root, "a.txt"), "moved on\n");
    git(["commit", "-aqm", "dev moved on"]);
    // Unrelated unstaged modification + staged new file: must survive.
    writeFileSync(join(root, "unrelated.txt"), "precious uncommitted\n");
    writeFileSync(join(root, "staged-new.txt"), "staged content\n");
    git(["add", "staged-new.txt"]);
    const beforeUnrelated = readFileSync(join(root, "unrelated.txt"), "utf8");
    const beforeStaged = readFileSync(join(root, "staged-new.txt"), "utf8");

    const { out, code } = await abortExitingNonZero(cfg);
    expect(code).toBe(1);
    expect(out).toContain("pop failed — stash preserved, tree left untouched");
    expect(out).toContain("Conflicted paths");
    expect(out).toContain("a.txt");
    expect(out).not.toContain("Abort complete");
    // Byte-identical survival of everything the stash did not touch.
    expect(readFileSync(join(root, "unrelated.txt"), "utf8")).toBe(beforeUnrelated);
    expect(readFileSync(join(root, "staged-new.txt"), "utf8")).toBe(beforeStaged);
    const status = git(["status", "--porcelain"]);
    expect(status).toContain("A  staged-new.txt");
    expect(status).toContain("M unrelated.txt");
    // The stash entry is preserved for manual resolution.
    expect(git(["stash", "list"])).toContain("worktree-finalize-2k5z");
  });

  test("restores interleaved finalize stashes without touching user stashes", async () => {
    // BUG-abort-pops-stashes-by-positional-ref…: popping captured stash@{N}
    // refs renumbers the stack mid-loop and destroys user stashes. The loop
    // must order pops highest-index-first and re-resolve each label.
    const cfg = makeRepo();
    const push = (file: string, message: string): void => {
      writeFileSync(join(root, file), `${file}\n`);
      git(["stash", "push", "-q", "-u", "-m", message, file]);
    };
    push("mine-1.txt", "user one");
    push("fin-1.txt", "worktree-finalize-aa1");
    push("mine-2.txt", "user two");
    push("fin-2.txt", "worktree-finalize-bb2");

    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("Found 2 finalize stash(es)");
    // Highest index first (oldest leftover restored first); after the drop
    // renumbers the stack, the label re-resolves to the live ref.
    expect(out).toContain("restored stash@{2}");
    expect(out).toContain("restored stash@{0}");
    const list = git(["stash", "list"]);
    expect(list).toContain("user one");
    expect(list).toContain("user two");
    expect(list).not.toContain("worktree-finalize");
    expect(existsSync(join(root, "fin-1.txt"))).toBe(true);
    expect(existsSync(join(root, "fin-2.txt"))).toBe(true);
    expect(existsSync(join(root, "mine-1.txt"))).toBe(false);
    expect(existsSync(join(root, "mine-2.txt"))).toBe(false);
  });

  test("ignores stashes that merely mention the finalize prefix", async () => {
    // loop-lore BUG-giwt-abort-runs-unscoped… AC: selection is anchored to
    // the whole finalize run label, not a message substring.
    const cfg = makeRepo();
    writeFileSync(join(root, "decoy.txt"), "decoy\n");
    git([
      "stash",
      "push",
      "-q",
      "-u",
      "-m",
      "notes on the worktree-finalize-bug investigation",
      "decoy.txt",
    ]);
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("No leftover finalize stashes");
    expect(out).toContain("not a finalize-run label — left untouched");
    expect(git(["stash", "list"])).toContain("worktree-finalize-bug");
    // The decoy was never popped back.
    expect(existsSync(join(root, "decoy.txt"))).toBe(false);
  });
});

describe("abort failure branches", () => {
  test("removeLockfile reports false when the lockfile cannot be unlinked", () => {
    const fs = {
      existsSync: () => true,
      readFileSync: () => "pid=7",
      unlinkSync: () => {
        throw new Error("EPERM: operation not permitted");
      },
    };
    expect(removeLockfile("/repo", fs)).toBe(false);
  });

  test("reports a failed merge --abort instead of failing silently", async () => {
    // The `<op> --abort` failure branch (abort.ts:242-243) is reachable
    // deterministically: a held index.lock makes `merge --abort` fail even
    // though MERGE_HEAD is abortable. abort must surface the failure and
    // keep the recovery report honest instead of claiming the op ended.
    const cfg = makeRepo();
    startConflictedMerge();
    writeFileSync(join(root, ".git", "index.lock"), "");
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
      unlinkSync(join(root, ".git", "index.lock"));
    }
    const out = cap.text();
    expect(out).toContain("Found MERGE_HEAD — aborting in-progress merge");
    expect(out).toContain("merge --abort failed — you may need manual intervention");
    expect(out).toContain("Stderr:");
    // The merge state survived (the operator resolves it manually).
    expect(existsSync(join(root, ".git", "MERGE_HEAD"))).toBe(true);
    expect(out).toContain("Abort complete");
  });

  test("aborts an in-progress cherry-pick with the real git subcommand", async () => {
    const cfg = makeRepo();
    startConflictedCherryPick();
    expect(existsSync(join(root, ".git", "CHERRY_PICK_HEAD"))).toBe(true);
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    // Regression: the op must be `cherry-pick`, not `cherry_pick`.
    expect(out).toContain("aborting in-progress cherry-pick");
    expect(out).toContain("aborted in-progress cherry-pick");
    expect(existsSync(join(root, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
  });

  // The `<op> --abort` failure log branch is unreachable with real git: a
  // bare MERGE_HEAD/CHERRY_PICK_HEAD is treated as abortable (exit 0), so
  // there is no deterministic in-process way to make git refuse.

  test("warns when the orphan rebase marker cannot be removed", async () => {
    const cfg = makeRepo();
    // A directory at REBASE_HEAD: present, orphaned, and un-unlinkable.
    mkdirSync(join(root, ".git", "REBASE_HEAD"));
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("Found orphan REBASE_HEAD");
    expect(out).toContain("could not remove orphan REBASE_HEAD — remove it manually");
    expect(existsSync(join(root, ".git", "REBASE_HEAD"))).toBe(true);
  });

  test("a failed pop keeps the stash, never resets, and exits non-zero", async () => {
    // BUG-abort-hard-resets-dev…: the old branch ran `reset --hard HEAD`
    // (failing here under the index lock) and still claimed success.
    const cfg = makeRepo();
    writeFileSync(join(root, "stash-me.txt"), "dirty\n");
    git(["stash", "push", "-q", "-u", "-m", "worktree-finalize-11", "stash-me.txt"]);
    // Hold the index lock so the pop itself fails.
    writeFileSync(join(root, ".git", "index.lock"), "");
    const { out, code } = await abortExitingNonZero(cfg);
    expect(code).toBe(1);
    expect(out).toContain("Found 1 finalize stash(es)");
    expect(out).toContain("pop failed — stash preserved, tree left untouched");
    expect(out).toContain("Stderr:");
    expect(out).not.toContain("Abort complete");
    expect(out).not.toContain("reset --hard");
    // The stash is preserved for manual recovery.
    expect(git(["stash", "list"])).toContain("worktree-finalize-11");
  });

  test("warns when the lockfile cannot be removed", async () => {
    const cfg = makeRepo();
    // A directory at the lockfile path: scan sees it, unlinkSync fails.
    mkdirSync(join(root, LOCK_FILENAME));
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("Found lockfile at");
    expect(out).toContain("could not remove lockfile");
  });
});
