// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Parallel-safe tests for the signal-safe finalize machinery.
 *
 * Resource contract (per `rule://parallel-safe-tests`):
 *   - Unit-level tests use an IN-MEMORY fs (`mapFs`) injected into the
 *     pure helpers. Zero filesystem state shared between tests.
 *   - Subprocess tests create a UNIQUE tmp directory per test, run a real
 *     `git init` inside it, and clean it up in `afterEach`. No test reads
 *     or writes the real repo's lockfile.
 *   - No module-level mutable state. No global counters.
 *   - All paths derived from `import.meta.dir` for the test file itself
 *     are read-only; mutable state lives only inside `beforeEach`.
 *
 * What we cover:
 *   1. `scanLockfile`     — present / absent / unreadable
 *   2. `removeLockfile`   — present-removes / absent-noop / error-swallowed
 *   3. `parseStashList`   — empty / single / multi-line / malformed
 *   4. `selectFinalizeStashes` — only FINALIZE_STASH_PREFIX entries
 *   5. End-to-end abort command against a per-test git repo (real
 *      subprocess) — dry-run is idempotent and does not mutate
 *
 * We deliberately do NOT exercise the live `finalize` flow because that
 * requires a real worktree + GPG-signed commit + dev checkout, which is
 * integration territory and not what these unit tests should cover.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type FsOps,
  LOCK_FILENAME,
  type LockfileScan,
  parseStashList,
  removeLockfile,
  scanLockfile,
  selectFinalizeStashes,
  type StashEntry,
} from "./commands/abort";

// --------------------------------------------------------------------------
// In-memory fs helper (unit tests)
// --------------------------------------------------------------------------

interface MemFs {
  fs: FsOps;
  files: Map<string, string>;
}

function memFs(): MemFs {
  const files = new Map<string, string>();
  return {
    files,
    fs: {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error(`ENOENT: ${p}`);
        return v;
      },
      unlinkSync: (p: string) => {
        files.delete(p);
      },
    },
  };
}

// --------------------------------------------------------------------------
// scanLockfile / removeLockfile (unit, in-memory fs)
// --------------------------------------------------------------------------

describe("scanLockfile", () => {
  let mem: MemFs;
  beforeEach(() => {
    mem = memFs();
  });
  test("returns present: false when no lockfile", () => {
    const scan: LockfileScan = scanLockfile("/fake/repo", mem.fs);
    expect(scan.present).toBe(false);
    expect(scan.path).toBe("/fake/repo/" + LOCK_FILENAME);
    expect(scan.owner).toBe("<unknown>");
  });

  test("returns present: true with owner PID when lockfile exists", () => {
    mem.files.set("/fake/repo/" + LOCK_FILENAME, "12345\n");
    const scan = scanLockfile("/fake/repo", mem.fs);
    expect(scan.present).toBe(true);
    expect(scan.owner).toBe("12345");
  });

  test("handles empty lockfile (treats owner as unknown)", () => {
    mem.files.set("/fake/repo/" + LOCK_FILENAME, "   \n");
    const scan = scanLockfile("/fake/repo", mem.fs);
    expect(scan.present).toBe(true);
    expect(scan.owner).toBe("<unknown>");
  });

  test("swallows read errors and returns present: true with unknown owner", () => {
    // Simulate an unreadable file: present per existsSync, but readFileSync
    // throws. (Real fs: a permission-denied file would behave the same.)
    const broken: FsOps = {
      ...mem.fs,
      readFileSync: () => {
        throw new Error("EACCES");
      },
    };
    const files = new Map<string, string>();
    files.set("/fake/repo/" + LOCK_FILENAME, "999");
    const fs2: FsOps = {
      existsSync: () => true,
      readFileSync: () => {
        throw new Error("EACCES");
      },
      unlinkSync: () => {},
    };
    const scan = scanLockfile("/fake/repo", fs2);
    expect(scan.present).toBe(true);
    expect(scan.owner).toBe("<unknown>");
    void broken;
    void files;
  });
});

describe("removeLockfile", () => {
  let mem: MemFs;
  beforeEach(() => {
    mem = memFs();
  });
  test("removes the lockfile when present", () => {
    const path = "/fake/repo/" + LOCK_FILENAME;
    mem.files.set(path, "111");
    expect(removeLockfile("/fake/repo", mem.fs)).toBe(true);
    expect(mem.files.has(path)).toBe(false);
  });

  test("returns false (no-op) when lockfile absent", () => {
    expect(removeLockfile("/fake/repo", mem.fs)).toBe(false);
    expect(mem.files.size).toBe(0);
  });

  test("swallows unlink errors and returns false", () => {
    const fs: FsOps = {
      existsSync: () => true,
      readFileSync: () => "1",
      unlinkSync: () => {
        throw new Error("EBUSY");
      },
    };
    expect(removeLockfile("/fake/repo", fs)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// parseStashList / selectFinalizeStashes (unit, pure)
// --------------------------------------------------------------------------

describe("parseStashList", () => {
  test("empty input returns empty array", () => {
    expect(parseStashList("")).toEqual([]);
  });

  test("single entry parses ref + message", () => {
    const [entry] = parseStashList("stash@{0}: WIP on dev: abc1234 some message");
    expect(entry!.ref).toBe("stash@{0}");
    expect(entry!.message).toBe("WIP on dev: abc1234 some message");
  });

  test("multi-line input returns all entries", () => {
    const entries: StashEntry[] = parseStashList(
      "stash@{0}: WIP on dev: abc worktree-finalize-foo\n"
        + "stash@{1}: WIP on dev: def worktree-finalize-bar\n"
        + "stash@{2}: On main: ghi user-stuff\n",
    );
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.ref)).toEqual(["stash@{0}", "stash@{1}", "stash@{2}"]);
  });

  test("skips empty lines and lines without a colon", () => {
    // Empty lines are skipped silently; lines without a colon are
    // unparseable stash output and must also be dropped (a real git
    // stash entry always has the form `stash@{N}: <message>`).
    const entries = parseStashList("\n  \nnot-a-stash-line\nstash@{0}: msg\n");
    expect(entries.length).toBe(1);
    expect(entries[0]?.ref).toBe("stash@{0}");
  });
});

describe("selectFinalizeStashes", () => {
  const mk = (ref: string, message: string): StashEntry => ({ ref, message });

  test("returns only entries with the finalize prefix", () => {
    const entries = [
      mk("stash@{0}", "WIP on dev: abc worktree-finalize-foo"),
      mk("stash@{1}", "On main: user-stuff"),
      mk("stash@{2}", "WIP on dev: def worktree-finalize-bar"),
    ];
    const selected = selectFinalizeStashes(entries);
    expect(selected.map((e) => e.ref)).toEqual(["stash@{0}", "stash@{2}"]);
  });

  test("returns empty array when no finalize stashes present", () => {
    const entries = [
      mk("stash@{0}", "On main: user-stuff"),
      mk("stash@{1}", "WIP on dev: abc my-feature"),
    ];
    expect(selectFinalizeStashes(entries)).toEqual([]);
  });

  test("returns empty array for empty input", () => {
    expect(selectFinalizeStashes([])).toEqual([]);
  });

  test("never touches user-authored stashes", () => {
    // Belt-and-braces: even if a user stash happens to contain the word
    // "finalize" in its message, only entries with the exact prefix
    // (worktree-finalize-) match.
    const entries = [
      mk("stash@{0}", "On main: do not finalize this"),
      mk("stash@{1}", "WIP on dev: 9999 worktree-finalize-x"),
    ];
    const selected = selectFinalizeStashes(entries);
    expect(selected.length).toBe(1);
    expect(selected[0]?.ref).toBe("stash@{1}");
  });
});

// --------------------------------------------------------------------------
// abort command (subprocess, per-test fake git repo)
// --------------------------------------------------------------------------

const SCRIPT_PATH = resolve(import.meta.dir, "cli.ts");

interface FakeRepo {
  root: string;
  cleanup: () => void;
}

function freshFakeRepo(): FakeRepo {
  const root = mkdtempSync(join(tmpdir(), "abort-test-"));
  const init = spawnSync("git", ["init", "-q", "-b", "dev", root], { encoding: "utf8" });
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
  // Configure identity so commits / stashes work.
  spawnSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", root, "config", "user.name", "test"]);
  // Create an initial commit so HEAD exists.
  spawnSync("git", ["-C", root, "commit", "--allow-empty", "-q", "-m", "init"]);
  return {
    root,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runAbort(
  repoRoot: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string; } {
  // Drive the abort command via bun, passing the fake repo root. The
  // command reads `repoRoot` from the WorktreeConfig; we set it via env
  // shim by spawning with cwd=repoRoot AND an env var that the script
  // honors. Currently the script uses `config.repoRoot` (passed by the
  // dispatcher). Since we can't reach `abort.ts` without the dispatcher,
  // we exercise the *pure helpers* above directly and use the subprocess
  // path only as a smoke test for the binary itself.
  //
  // For the subprocess smoke, we just verify the binary exits 0 against
  // an empty fake repo (no lockfile, no in-progress heads, no stashes).
  void repoRoot;
  return spawnSync(
    "bun",
    [SCRIPT_PATH, "abort", ...args],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, CHECK_SKIP_GPG_PRECHECK: "1" } },
  );
}

describe("abort command (per-test fake git repo)", () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = freshFakeRepo();
  });
  afterEach(() => {
    repo.cleanup();
  });

  test("dry-run against a clean repo reports clean state and exits 0", () => {
    const res = runAbort(repo.root, ["--dry-run"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Finalize abort");
    expect(res.stdout + res.stderr).toContain("DRY RUN");
    expect(res.stdout).toContain("No lockfile present");
    expect(res.stdout).toContain("No leftover finalize stashes");
  });

  test("dry-run does not mutate the fake repo", () => {
    // Run records (.tmp/) are a sanctioned scratchpad side effect of every
    // dispatch; the guard is about checkout state, so .tmp lines are
    // excluded from the comparison.
    const trackedStatus = (out: string | undefined) =>
      (out ?? "").split("\n").filter((l) => l.trim().length > 0 && !l.trim().endsWith(".tmp/"))
        .sort().join("\n");
    const before = spawnSync("git", ["-C", repo.root, "status", "--porcelain"], {
      encoding: "utf8",
    });
    const res = runAbort(repo.root, ["--dry-run"]);
    const after = spawnSync("git", ["-C", repo.root, "status", "--porcelain"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(trackedStatus(before.stdout)).toBe(trackedStatus(after.stdout));
  });

  test("two consecutive dry-runs are idempotent", () => {
    const a = runAbort(repo.root, ["--dry-run"]);
    const b = runAbort(repo.root, ["--dry-run"]);
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    // Both runs should produce the same Final dev checkout state.
    const extractHead = (out: string): string =>
      out.split("\n").find((l) => l.startsWith("  HEAD:")) ?? "";
    expect(extractHead(a.stdout)).toBe(extractHead(b.stdout));
    expect(extractHead(a.stdout).length > 0).toBe(true);
  });

  test("removes a lockfile placed in the fake repo root", () => {
    // Write a lockfile directly into the fake repo, then run abort and
    // verify it's gone. Uses the fake repo's own .worktree-finalize.lock.
    const lockPath = join(repo.root, LOCK_FILENAME);
    spawnSync("sh", ["-c", `echo 9999999 > ${lockPath}`]);
    expect(runAbort(repo.root, []).status).toBe(0);
    const exists = spawnSync("test", ["-f", lockPath]).status;
    expect(exists).not.toBe(0); // file should be gone
  });

  test("dry-run does NOT remove a lockfile placed in the fake repo", () => {
    const lockPath = join(repo.root, LOCK_FILENAME);
    spawnSync("sh", ["-c", `echo 9999999 > ${lockPath}`]);
    expect(runAbort(repo.root, ["--dry-run"]).status).toBe(0);
    const exists = spawnSync("test", ["-f", lockPath]).status;
    expect(exists).toBe(0); // file should still be there
  });
});
