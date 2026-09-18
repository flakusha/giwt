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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

  test("cleans the tree and reports a failed reset when a finalize stash pop fails", async () => {
    const cfg = makeRepo();
    writeFileSync(join(root, "stash-me.txt"), "dirty\n");
    git(["stash", "push", "-q", "-u", "-m", "worktree-finalize-11", "stash-me.txt"]);
    // Hold the index lock so both `stash pop` and `reset --hard` fail.
    writeFileSync(join(root, ".git", "index.lock"), "");
    const cap = capture();
    try {
      await abort([], cfg);
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("Found 1 finalize stash(es)");
    expect(out).toContain("pop conflicted — preserving stash, cleaning tree");
    expect(out).toContain("reset --hard HEAD failed");
    expect(out).toContain("Stderr:");
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
