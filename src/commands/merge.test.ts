// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt merge <branch> <source>` — the worktree-target workflow.
 *
 * Coverage:
 *   - argument validation (both args required)
 *   - the worktree-only contract and its create+finalize remedy
 *     (FIX-errors-carry-no-remedy regression)
 *   - the source-branch existence check
 *   - the uncommitted-changes gate, for unstaged and staged-only edits
 *   - happy path over a real diverged fixture: a merge commit with both
 *     parents, both sides' files present
 *   - GPG behavior: unsigned when no key is configured, signed with a real
 *     throwaway keyring, and a graceful fall-back to unsigned when the
 *     configured key is not in the keyring
 *   - conflicted merge: the error names the worktree and the conflict is
 *     left in place (MERGE_HEAD + conflict markers)
 *
 * Real git and a real gpg-agent: these failure modes are tool-behavior
 * shaped (porcelain exit codes, merge parents, signatures), so in-memory
 * fakes would prove nothing.
 *
 * Resource contract (parallel-safe): every test owns a private scratch repo
 * and a private tree dir from mkdtempSync — the tree dir lives outside the
 * repo so a plain `git add .` never stages the worktree as a gitlink — both
 * torn down in afterEach. The gpg keyring is one per-file throwaway
 * GNUPGHOME (unique, module-private), killed and removed in afterAll.
 *
 * gpg gate seam: assertAgentGpgUnlocked() reads the import-time credentials
 * singleton, which has no injection point, so runMerge pins it — plus
 * GNUPGHOME and the ambient GIT_* hook context — to the fixture keyring for
 * the merge body's synchronous span only and restores it before the first
 * await; no other test file can observe the mutation. The swap only works
 * because merge.ts/gpg.ts spawn their gpg and git children with an explicit
 * env (process.env / isolatedGitEnv()): a Bun.spawnSync call without `env`
 * uses a process-startup snapshot and would ignore it.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { branchToPath, type WorktreeConfig } from "../utils/config";
import { credentials } from "../utils/credentials";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel, setOutputFormat } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { merge } from "./merge";

const GPG_UID = "giwt-merge-test@example.local";
const gpgTooling = Boolean(Bun.which("gpg") && Bun.which("gpgconf"));

let root: string;
let treesRoot: string;
let treeDir: string;
let config: WorktreeConfig;
let gpgHome: string;
let gpgKeyId: string;

/** Run git in the fixture repo (or a given dir); throw on failure. */
function git(args: string[], cwd: string = root): string {
  // Strip the hook/parent environment's git context (GIT_DIR, GIT_INDEX_FILE,
  // …): pre-commit runs with relative paths that a child `git -C <tmpdir>`
  // would resolve against the fixture and fail with ENOTDIR.
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

/** Commit `name` = `content` in `dir` (worktree or main checkout). */
function commitFile(dir: string, name: string, content: string, message: string): void {
  writeFileSync(join(dir, name), content);
  git(["add", "."], dir);
  git(["commit", "-qm", message], dir);
}

/** Create a real linked worktree for `branch` under the fixture treeDir. */
function addWorktree(branch: string, base = "main"): string {
  const wtPath = resolve(treeDir, branchToPath(branch));
  git(["worktree", "add", "-q", "-b", branch, wtPath, base]);
  return wtPath;
}

/** Diverged fixture: the worktree branch has its own commit, main advanced. */
function diverge(): string {
  const wtPath = addWorktree("dev");
  commitFile(wtPath, "dev.txt", "dev\n", "dev work");
  commitFile(root, "main.txt", "main\n", "main work");
  return wtPath;
}

/**
 * Signature verdict for the worktree HEAD with the fixture keyring in scope:
 * git's verification reads the key from GNUPGHOME, which runMerge has already
 * restored by assertion time.
 */
function signedVerdict(wtPath: string): string {
  const result = Bun.spawnSync(["git", "-C", wtPath, "log", "-1", "--format=%G?|%GS"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedGitEnv(), GNUPGHOME: gpgHome },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git log failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

interface MergeRun {
  output: string;
  exitCode: number | null;
  error: Error | null;
}

/**
 * Drive merge() with stdout/stderr captured and process.exit stubbed to a
 * throwing sentinel; never throws for merge's own failures.
 *
 * With `gpgKeyId`, the credentials singleton and GNUPGHOME are pinned to the
 * fixture gpg keyring (and ambient GIT_* hook context stripped) for the
 * synchronous merge body, then restored before the first await.
 */
async function runMerge(
  args: string[],
  opts: { gpgKeyId?: string; } = {},
): Promise<MergeRun> {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  const exits: number[] = [];
  const exitSpy = spyOn(process, "exit").mockImplementation(
    ((code?: number) => {
      exits.push(code ?? 0);
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit,
  );

  const savedFound = credentials.found;
  const savedKeyId = credentials.keyId;
  const savedGit: Array<[string, string]> = [];
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) {
      savedGit.push([key, process.env[key]!]);
      delete process.env[key];
    }
  }
  const savedGnupg = process.env.GNUPGHOME;
  const restoreEnv = (): void => {
    credentials.found = savedFound;
    credentials.keyId = savedKeyId;
    for (const [key, value] of savedGit) process.env[key] = value;
    if (savedGnupg === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = savedGnupg;
  };

  let error: Error | null = null;
  try {
    if (opts.gpgKeyId) {
      credentials.found = true;
      credentials.keyId = opts.gpgKeyId;
      process.env.GNUPGHOME = gpgHome;
    }
    let promise!: Promise<void>;
    try {
      promise = merge(args, config);
    } finally {
      restoreEnv();
    }
    await promise;
  } catch (err) {
    error = err as Error;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return {
    output: chunks.join(""),
    exitCode: exits.length > 0 ? exits[exits.length - 1]! : null,
    error,
  };
}

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  root = mkdtempSync(join(tmpdir(), "giwt-merge-test-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-qm", "seed"]);
  treesRoot = mkdtempSync(join(tmpdir(), "giwt-merge-trees-"));
  treeDir = resolve(treesRoot, "tree");
  mkdirSync(treeDir);
  config = { repoRoot: root, worktreeRoot: root, treeDir, settings: DEFAULT_SETTINGS };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(treesRoot, { recursive: true, force: true });
});

beforeAll(() => {
  if (!gpgTooling) return;
  const home = mkdtempSync(join(tmpdir(), "giwt-merge-gpg-"));
  // pinentry /bin/false: any accidental prompt dies instantly instead of
  // hanging the suite. Empty passphrase: the cancel-mode trial sign in
  // assertAgentGpgUnlocked() succeeds, so the gate passes without a cache warm.
  writeFileSync(join(home, "gpg-agent.conf"), "pinentry-program /bin/false\n");
  const gen = Bun.spawnSync(
    [
      "gpg",
      "--batch",
      "--pinentry-mode",
      "loopback",
      "--passphrase",
      "",
      "--quick-generate-key",
      GPG_UID,
      "ed25519",
      "sign",
      "0",
    ],
    { stdout: "ignore", stderr: "pipe", env: { ...process.env, GNUPGHOME: home } },
  );
  if (gen.exitCode !== 0) {
    rmSync(home, { recursive: true, force: true });
    throw new Error(`gpg fixture keygen failed: ${gen.stderr.toString()}`);
  }
  const listed = Bun.spawnSync(["gpg", "--list-secret-keys", "--with-colons", GPG_UID], {
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, GNUPGHOME: home },
  });
  const fpr = listed.stdout.toString().split("\n").find((line) => line.startsWith("fpr:"))
    ?.split(":")[9];
  if (!fpr) {
    rmSync(home, { recursive: true, force: true });
    throw new Error("gpg fixture key has no fingerprint");
  }
  gpgHome = home;
  gpgKeyId = fpr;
});

afterAll(() => {
  if (!gpgHome) return;
  Bun.spawnSync(["gpgconf", "--homedir", gpgHome, "--kill", "gpg-agent"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  rmSync(gpgHome, { recursive: true, force: true });
});

describe("merge argument validation", () => {
  test("requires both branch and source", async () => {
    const run = await runMerge([]);
    expect(run.exitCode).toBe(1);
    expect(run.error?.message).toBe("__exit__:1");
    expect(run.output).toContain("branch and source required");
    expect(run.output).toContain("Usage: giwt merge <branch> <source>");
  });

  test("rejects a source branch that does not exist", async () => {
    addWorktree("dev");
    const before = git(["rev-parse", "dev"]).trim();

    const run = await runMerge(["dev", "no-such-source"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("source branch 'no-such-source' does not exist");
    // Nothing was merged.
    expect(git(["rev-parse", "dev"]).trim()).toBe(before);
  });
});

describe("merge worktree target contract (FIX-errors-carry-no-remedy)", () => {
  test("names the worktree-only contract and the create+finalize path", async () => {
    // A treeDir with no worktrees registered for any branch.
    config = { ...config, treeDir: join(root, "no-worktrees") };

    const run = await runMerge(["dev", "skip-heavy-db"]);

    expect(run.error?.message).toBe("__exit__:1");
    expect(run.output).toContain("no worktree found for branch 'dev'");
    // The worktree-only contract is explained.
    expect(run.output).toContain("worktree checkouts only");
    // The create+finalize path is suggested with exact commands.
    expect(run.output).toContain("giwt new-branch dev");
    expect(run.output).toContain("giwt finalize");
  });
});

describe("merge uncommitted-changes gate", () => {
  test("refuses when the worktree has unstaged edits", async () => {
    const wtPath = addWorktree("dev");
    const before = git(["rev-parse", "dev"]).trim();
    writeFileSync(join(wtPath, "seed.txt"), "dirty\n");
    expect(git(["status", "--porcelain"], wtPath).trim()).toBe("M seed.txt");

    const run = await runMerge(["dev", "main"]);

    expect(run.exitCode).toBe(1);
    expect(run.error?.message).toBe("__exit__:1");
    expect(run.output).toContain("uncommitted changes in worktree 'dev'");
    // The merge never ran: the branch still points at the pre-merge commit.
    expect(git(["rev-parse", "dev"]).trim()).toBe(before);
  });

  test("refuses when the worktree has staged-only edits", async () => {
    const wtPath = addWorktree("dev");
    writeFileSync(join(wtPath, "staged.txt"), "staged\n");
    git(["add", "staged.txt"], wtPath);
    // Precondition: the unstaged area is clean, so only the staged check can
    // reject this worktree.
    expect(git(["status", "--porcelain"], wtPath).trim()).toBe("A  staged.txt");

    const run = await runMerge(["dev", "main"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("uncommitted changes in worktree 'dev'");
  });
});

describe.skipIf(!gpgTooling)("merge over real git and a real gpg agent", () => {
  test("merges the source into the worktree with a merge commit", async () => {
    const wtPath = diverge();
    const devBefore = git(["rev-parse", "dev"]).trim();
    const mainHead = git(["rev-parse", "main"]).trim();

    const run = await runMerge(["dev", "main"], { gpgKeyId });

    expect(run.error).toBeNull();
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Merging 'main' into 'dev'...");
    expect(run.output).toContain("Merged 'main' into 'dev'");
    // A real merge commit: parents are the pre-merge branch tip and the source.
    expect(git(["rev-parse", "HEAD^1", "HEAD^2"], wtPath).trim().split("\n")).toEqual([
      devBefore,
      mainHead,
    ]);
    expect(existsSync(join(wtPath, "main.txt"))).toBe(true);
    expect(existsSync(join(wtPath, "dev.txt"))).toBe(true);
    // No signing key is configured, so the commit carries no signature.
    expect(git(["log", "-1", "--format=%G?"], wtPath).trim()).toBe("N");
  });

  test("signs the merge commit with the configured key", async () => {
    const wtPath = diverge();
    config = { ...config, agentGpgKeyId: gpgKeyId };

    const run = await runMerge(["dev", "main"], { gpgKeyId });

    expect(run.error).toBeNull();
    expect(run.exitCode).toBeNull();
    const [status, signer] = signedVerdict(wtPath).split("|");
    expect(status).toBe("G");
    expect(signer).toContain(GPG_UID);
    expect(git(["rev-parse", "--verify", "HEAD^2"], wtPath).trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  test("falls back to an unsigned merge when the configured key is absent from the keyring", async () => {
    const wtPath = diverge();
    config = { ...config, agentGpgKeyId: "DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF" };

    const run = await runMerge(["dev", "main"], { gpgKeyId });

    expect(run.error).toBeNull();
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Merged 'main' into 'dev'");
    expect(git(["rev-parse", "--verify", "HEAD^2"], wtPath).trim()).toMatch(/^[0-9a-f]{40}$/);
    expect(git(["log", "-1", "--format=%G?"], wtPath).trim()).toBe("N");
  });

  test("reports a conflicted merge and leaves the conflict in the worktree", async () => {
    const wtPath = addWorktree("dev");
    commitFile(wtPath, "conflict.txt", "dev side\n", "dev side");
    commitFile(root, "conflict.txt", "main side\n", "main side");

    const run = await runMerge(["dev", "main"], { gpgKeyId });

    expect(run.exitCode).toBe(1);
    expect(run.error?.message).toBe("__exit__:1");
    expect(run.output).toContain(`merge failed — resolve conflicts in ${wtPath}`);
    // The worktree is left mid-merge for the caller to resolve.
    expect(git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], wtPath).trim()).not.toBe("");
    expect(readFileSync(join(wtPath, "conflict.txt"), "utf8")).toContain("<<<<<<<");
  });
});
