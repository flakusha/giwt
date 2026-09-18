// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for stale worktree-registry reconciliation (ticket
 * FIX-stale-worktree-registry): the git worktree registry drifts when a
 * worktree directory is deleted behind git's back and/or the branch ref is
 * force-removed. list must mark such entries stale, create must auto-prune
 * instead of warning "already exists", and remove must prune instead of
 * erroring "no worktree found".
 *
 * Resource contract (parallel-safe): every test owns a private scratch git
 * repo from mkdtempSync, torn down in afterEach — no shared paths, no
 * ordering dependence, no global state. Each test also uses a unique
 * branch name so a leaked fixture could not alias another test's.
 *
 * End-to-end over the real execute() functions against real git — the
 * failure modes are git-behavior shaped (porcelain output, prune rules),
 * so in-memory fakes would prove nothing. Verified against git 2.55.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { branchToPath, type WorktreeConfig } from "../utils/config";
import { getWorktrees } from "../utils/git";
import { setLogLevel, setOutputFormat } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute as createExecute } from "./create";
import { listWorktrees } from "./list";
import { execute as removeExecute } from "./remove";
import { findRegistration, recoverableHead, staleReasons } from "./worktree-registry";

let root: string;
let treeDir: string;
let config: WorktreeConfig;

/** Run git in the fixture repo (or a given dir); throw on failure. */
function git(args: string[], cwd: string = root): string {
  // Strip the hook/parent environment's git context (GIT_DIR, GIT_INDEX_FILE,
  // …): pre-commit runs with relative paths that a child `git -C <tmpdir>`
  // would resolve against the fixture and fail with ENOTDIR.
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

/** Capture log()/raw() traffic on both streams; keep test output clean. */
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

/** Create a real linked worktree for `branch` in the fixture treeDir. */
function addWorktree(branch: string): string {
  const wtPath = resolve(treeDir, branchToPath(branch));
  git(["worktree", "add", "-q", "-b", branch, wtPath, "main"]);
  return wtPath;
}

/**
 * Build a stale registration: worktree exists, then its directory is
 * rm -rf'd and the branch ref is force-deleted (update-ref bypasses the
 * checked-out guard). With `detach`, the worktree is first put on a
 * detached HEAD — the ticket-incident shape where the registration's HEAD
 * file holds a real, recoverable sha.
 */
function makeStale(
  branch: string,
  opts: { detach?: boolean; } = {},
): { wtPath: string; head: string; } {
  const wtPath = addWorktree(branch);
  let head = git(["rev-parse", branch]).trim();
  if (opts.detach) {
    git(["checkout", "--detach", "-q"], wtPath);
    head = git(["rev-parse", "HEAD"], wtPath).trim();
  }
  rmSync(wtPath, { recursive: true, force: true });
  git(["update-ref", "-d", `refs/heads/${branch}`]);
  return { wtPath, head };
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

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  root = mkdtempSync(join(tmpdir(), "giwt-registry-test-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-qm", "seed"]);
  treeDir = resolve(root, "tree");
  mkdirSync(treeDir);
  config = { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("list: stale registry reconciliation", () => {
  test("marks an entry whose directory and branch ref are gone", async () => {
    const { wtPath } = makeStale("gone-list");
    const cap = captureOutput();
    try {
      await listWorktrees([], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("(stale: directory missing, branch ref missing)");
    expect(out).toContain(wtPath);
    expect(out).toContain("prune with: giwt remove gone-list");
    // exactly one stale marker — the healthy main checkout renders normal
    expect(out.split("(stale:").length - 1).toBe(1);
    expect(out).toContain("Worktrees");
  });

  test("renders an unknown HEAD for the all-zero dangling registration", async () => {
    makeStale("gone-zero"); // symref registration -> porcelain HEAD all-zeros
    const cap = captureOutput();
    try {
      await listWorktrees([], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("HEAD: <unknown>");
  });
});

describe("create: stale registry reconciliation", () => {
  test("auto-prunes a stale registration whose directory is gone (ref intact)", async () => {
    const wtPath = addWorktree("drift-create");
    rmSync(wtPath, { recursive: true, force: true });
    const cap = captureOutput();
    try {
      await createExecute(["drift-create"], config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).not.toContain("already exists");
    expect(out).toContain("pruning stale worktree registration");
    expect(existsSync(resolve(wtPath, ".git"))).toBe(true);
    const reg = findRegistration(await getWorktrees(root), wtPath);
    expect(reg?.branch).toBe("refs/heads/drift-create");
  });

  test("recovers the branch when directory AND ref are gone (ticket scenario)", async () => {
    const { wtPath, head } = makeStale("gone-create", { detach: true });
    const cap = captureOutput();
    try {
      await createExecute(["gone-create"], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("recovered branch 'gone-create'");
    expect(git(["rev-parse", "refs/heads/gone-create"]).trim()).toBe(head);
    expect(existsSync(resolve(wtPath, ".git"))).toBe(true);
    const reg = findRegistration(await getWorktrees(root), wtPath);
    expect(reg?.branch).toBe("refs/heads/gone-create");
  });

  test("prunes the stale registration and errors with a next step when its HEAD is unrecoverable", async () => {
    const { wtPath } = makeStale("gone-symref"); // dangling symref -> all-zero HEAD
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await createExecute(["gone-symref"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    const out = cap.lines();
    expect(out).toContain("does not exist");
    expect(out).toContain("git branch gone-symref <base>");
    expect(out).toContain("pruned stale worktree registration");
    // registry was cleaned even though create failed
    expect(findRegistration(await getWorktrees(root), wtPath)).toBeUndefined();
  });

  test("clears an empty leftover directory instead of warning 'already exists'", async () => {
    git(["branch", "husk-create", "main"]);
    const husk = resolve(treeDir, "husk-create");
    mkdirSync(husk);
    const cap = captureOutput();
    try {
      await createExecute(["husk-create"], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).not.toContain("already exists");
    expect(cap.lines()).toContain("removed empty leftover directory");
    expect(existsSync(resolve(husk, ".git"))).toBe(true);
  });

  test("warns without touching an unregistered non-empty directory", async () => {
    git(["branch", "foreign-dir", "main"]);
    const dir = resolve(treeDir, "foreign-dir");
    mkdirSync(dir);
    writeFileSync(resolve(dir, "user-file.txt"), "keep me");
    const cap = captureOutput();
    try {
      await createExecute(["foreign-dir"], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("not a registered worktree");
    expect(existsSync(resolve(dir, "user-file.txt"))).toBe(true);
  });

  test("baseline: a healthy branch still creates its worktree", async () => {
    git(["branch", "fresh-create", "main"]);
    const cap = captureOutput();
    try {
      await createExecute(["fresh-create"], config);
    } finally {
      cap.restore();
    }
    expect(existsSync(resolve(treeDir, "fresh-create", ".git"))).toBe(true);
  });
});

describe("remove: stale registry reconciliation", () => {
  test("prunes the registration instead of erroring when dir and ref are gone", async () => {
    const { wtPath } = makeStale("gone-remove");
    const cap = captureOutput();
    try {
      await removeExecute(["gone-remove"], config);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).toContain("pruned stale registration for branch 'gone-remove'");
    expect(findRegistration(await getWorktrees(root), wtPath)).toBeUndefined();
  });

  test("errors with a next step when no worktree was ever created", async () => {
    const exit = mockExit();
    const cap = captureOutput();
    let threw = false;
    try {
      await removeExecute(["never-created"], config);
    } catch (error) {
      threw = String(error).includes("__exit:1");
    } finally {
      cap.restore();
      exit.restore();
    }
    expect(threw).toBe(true);
    expect(exit.calls).toEqual([1]);
    expect(cap.lines()).toContain("giwt create never-created");
  });

  test("baseline: a healthy worktree is removed normally", async () => {
    const wtPath = addWorktree("healthy-remove");
    const cap = captureOutput();
    try {
      await removeExecute(["healthy-remove"], config);
    } finally {
      cap.restore();
    }
    expect(existsSync(resolve(wtPath, ".git"))).toBe(false);
    expect(findRegistration(await getWorktrees(root), wtPath)).toBeUndefined();
  });
});

describe("staleReasons / recoverableHead", () => {
  test("healthy registration: no stale reasons, real HEAD", async () => {
    const wtPath = addWorktree("reasons-healthy");
    const reg = findRegistration(await getWorktrees(root), wtPath);
    expect(reg).toBeDefined();
    expect(staleReasons(root, reg!)).toEqual({ dirMissing: false, refMissing: false });
    expect(recoverableHead(reg!)).toBe(git(["rev-parse", "reasons-healthy"]).trim());
  });

  test("detached stale registration: dir missing, HEAD still recoverable", async () => {
    const { wtPath, head } = makeStale("reasons-detached", { detach: true });
    const reg = findRegistration(await getWorktrees(root), wtPath);
    expect(reg).toBeDefined();
    const reasons = staleReasons(root, reg!);
    expect(reasons.dirMissing).toBe(true);
    expect(reasons.refMissing).toBe(false); // detached: no branch ref to miss
    expect(recoverableHead(reg!)).toBe(head);
  });

  test("symref stale registration: dir + ref missing, HEAD unrecoverable", async () => {
    const { wtPath } = makeStale("reasons-symref");
    const reg = findRegistration(await getWorktrees(root), wtPath);
    expect(reg).toBeDefined();
    const reasons = staleReasons(root, reg!);
    expect(reasons.dirMissing).toBe(true);
    expect(reasons.refMissing).toBe(true);
    expect(recoverableHead(reg!)).toBeNull();
  });
});
