// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt worktree finalize` (src/commands/finalize.ts).
 *
 * finalize is the mutating end of the worktree workflow: it gates on a clean
 * dev checkout, integrates the branch into the root checkout (rebase+ff,
 * squash, or direct), removes the worktree and deletes the branch. These
 * tests drive the real `finalize()` entry point in-process against a scratch
 * git repo per test, so the branches that matter — preflight refusals, gate
 * forwarding, stash/restore rollback, merge strategies, teardown — are
 * exercised against real git behavior rather than fakes: porcelain exit
 * codes, ff-vs-merge topology and stash conflicts ARE the contract.
 *
 * process.exit is stubbed to a throwing `__exit__:<code>` sentinel (project
 * convention), so an operator refusal is observable as
 * `{ exitCode: 1, error: "__exit__:1" }` instead of killing the runner.
 * finalize's `uninstallSignalHandlers()` calls removeAllListeners() for
 * SIGINT/SIGTERM/SIGHUP/"exit"; driveFinalize() snapshots those listener sets
 * before the call and restores them afterwards, so no listener owned by the
 * test runner or a sibling file is dropped.
 *
 * Resource contract (parallel-safe): every test owns a private scratch repo
 * (root), a private tree dir and a private tools dir from mkdtempSync, all
 * torn down in afterEach. tree/ and the tools dir live outside the repo so
 * scratch check/test scripts never appear as untracked files in a checkout
 * finalize inspects. The gpg keyring is one per-file throwaway GNUPGHOME
 * (unique, module-private), killed and removed in afterAll.
 *
 * credentials/GNUPGHOME seam: assertAgentGpgUnlocked() reads the import-time
 * credentials singleton, so the gpg-gated strategies pin it — plus
 * GNUPGHOME — to the fixture keyring for the synchronous span only and
 * restore before the first await (same pattern as merge.test.ts).
 * gpgMergeFlags() spawns gpg without an explicit env, so it sees the
 * runner's startup keyring rather than the fixture one; the merge in those
 * tests therefore stays unsigned on purpose, which is exactly what the
 * verify step must refuse.
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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { branchToPath, type WorktreeConfig } from "../utils/config";
import { credentials } from "../utils/credentials";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel, setOutputFormat } from "../utils/output";
import { beginRun } from "../utils/runlog";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { finalize } from "./finalize";

const GPG_UID = "giwt-finalize-test@example.local";
const gpgTooling = Boolean(Bun.which("gpg") && Bun.which("gpgconf"));

/** Signals finalize installs/uninstalls handlers for. */
const FINALIZE_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

let root: string;
let treesRoot: string;
let treeDir: string;
let toolsRoot: string;
let toolsDir: string;
/** File the recording check command writes its argv into. */
let argsPath: string;
let config: WorktreeConfig;
let gpgHome = "";
let gpgKeyId = "";

// --------------------------------------------------------------------------
// Scratch-repo fixtures
// --------------------------------------------------------------------------

/** Run git in `cwd`; throw on failure (fixture setup errors must be loud). */
function git(args: string[], cwd: string = root): string {
  // Strip the hook/parent GIT_* context: a relative GIT_INDEX_FILE from a
  // pre-commit hook would resolve against the scratch repo and fail.
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

/** Exit code of a git call that is allowed to fail (broken repo states). */
function gitExitCode(args: string[], cwd: string = root): number {
  return Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  }).exitCode;
}

/** Commit `name` = `content` in `dir`. */
function commitFile(dir: string, name: string, content: string, message: string): void {
  writeFileSync(join(dir, name), content);
  git(["add", "."], dir);
  git(["commit", "-qm", message], dir);
}

/** Create a linked worktree for `branch` under the fixture treeDir. */
function addWorktree(branch: string, base = "main"): string {
  const wtPath = resolve(treeDir, branchToPath(branch));
  git(["worktree", "add", "-q", "-b", branch, wtPath, base]);
  return wtPath;
}

/** Standard fixture: root on main plus a worktree branch with one commit. */
function featureWorktree(branch = "feature/x"): string {
  const wtPath = addWorktree(branch);
  commitFile(wtPath, "feature.txt", "feature\n", "feature work");
  return wtPath;
}

/** Write an executable scratch script outside both checkouts. */
function shScript(name: string, body: string): string {
  const path = join(toolsDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Point the configurable check/test commands at scratch scripts. */
function configureCommands(checkBody: string, testBody = "exit 0"): void {
  config.settings.commands.check = `sh ${shScript("check.sh", checkBody)}`;
  config.settings.commands.test = `sh ${shScript("test.sh", testBody)}`;
}

/** Enable the gate steps (they only run when the worktree has a bun.lock). */
function withBunLock(wtPath: string): void {
  writeFileSync(join(wtPath, "bun.lock"), "");
}

// --------------------------------------------------------------------------
// Driving finalize() in-process
// --------------------------------------------------------------------------

interface FinalizeRun {
  output: string;
  exitCode: number | null;
  error: Error | null;
}

/**
 * Call finalize() with stdout/stderr captured and process.exit stubbed to a
 * throwing sentinel. Never rejects for finalize's own refusals.
 */
async function driveFinalize(args: string[], cfg: WorktreeConfig = config): Promise<FinalizeRun> {
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

  // finalize's uninstallSignalHandlers() deletes every listener for these
  // events process-wide. Snapshot first, restore after, so nothing owned by
  // the runner (or a sibling test file in this process) is lost.
  const savedExit = process.listeners("exit");
  const savedSignals = FINALIZE_SIGNALS.map((sig) => [sig, process.listeners(sig)] as const);

  let error: Error | null = null;
  try {
    await finalize(args, cfg);
  } catch (err) {
    error = err as Error;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    process.removeAllListeners("exit");
    for (const listener of savedExit) process.on("exit", listener as () => void);
    for (const [sig, listeners] of savedSignals) {
      process.removeAllListeners(sig);
      for (const listener of listeners) process.on(sig, listener as () => void);
    }
  }
  return {
    output: chunks.join(""),
    exitCode: exits.length > 0 ? exits[exits.length - 1]! : null,
    error,
  };
}

/**
 * Pin the credentials singleton + GNUPGHOME to the fixture keyring for the
 * synchronous span of `finalize()` (its body runs synchronously up to the
 * first await), then restore before awaiting the promise.
 */
function driveGpgFinalize(
  args: string[],
  cfg: WorktreeConfig = config,
): Promise<FinalizeRun> {
  const savedFound = credentials.found;
  const savedKeyId = credentials.keyId;
  const savedHome = process.env.GNUPGHOME;
  const restore = (): void => {
    credentials.found = savedFound;
    credentials.keyId = savedKeyId;
    if (savedHome === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = savedHome;
  };
  let promise!: Promise<FinalizeRun>;
  try {
    credentials.found = true;
    credentials.keyId = gpgKeyId;
    process.env.GNUPGHOME = gpgHome;
    promise = driveFinalize(args, cfg);
  } finally {
    restore();
  }
  return promise;
}

/** Pin "no agent credentials loaded" for the synchronous span. */
function driveWithoutGpgCredentials(
  args: string[],
  cfg: WorktreeConfig = config,
): Promise<FinalizeRun> {
  const savedFound = credentials.found;
  const savedKeyId = credentials.keyId;
  let promise!: Promise<FinalizeRun>;
  try {
    credentials.found = false;
    credentials.keyId = "";
    promise = driveFinalize(args, cfg);
  } finally {
    credentials.found = savedFound;
    credentials.keyId = savedKeyId;
  }
  return promise;
}

// --------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  root = mkdtempSync(join(tmpdir(), "giwt-finalize-test-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt finalize test"]);
  git(["config", "commit.gpgsign", "false"]);
  // The finalize lockfile is an intentional resident of the dev checkout;
  // ignoring it keeps the stash/untracked paths of a clean fixture clean.
  writeFileSync(join(root, ".gitignore"), ".worktree-finalize.lock\n.tmp/\n");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-qm", "seed"]);
  treesRoot = mkdtempSync(join(tmpdir(), "giwt-finalize-trees-"));
  treeDir = resolve(treesRoot, "tree");
  mkdirSync(treeDir);
  toolsRoot = mkdtempSync(join(tmpdir(), "giwt-finalize-tools-"));
  toolsDir = resolve(toolsRoot, "tools");
  mkdirSync(toolsDir);
  argsPath = join(toolsDir, "check-args.txt");
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir,
    settings: structuredClone(DEFAULT_SETTINGS),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(treesRoot, { recursive: true, force: true });
  rmSync(toolsRoot, { recursive: true, force: true });
});

beforeAll(() => {
  if (!gpgTooling) return;
  const home = mkdtempSync(join(tmpdir(), "giwt-finalize-gpg-"));
  // pinentry /bin/false: an accidental prompt dies instantly instead of
  // hanging the suite. Empty passphrase: the cancel-mode trial sign in
  // assertAgentGpgUnlocked() succeeds, so the gate passes without a warm cache.
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

// --------------------------------------------------------------------------
// Entry validation
// --------------------------------------------------------------------------

describe("finalize entry validation", () => {
  test("rejects an unknown merge strategy", async () => {
    featureWorktree();
    const run = await driveFinalize(["feature/x", "--merge-strategy", "yolo"]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("unknown merge strategy 'yolo'");
    expect(run.output).toContain("use rebase, squash, or direct");
  });

  test("requires a branch name and prints usage", async () => {
    const run = await driveFinalize([]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("branch name required");
    expect(run.output).toContain("Usage: giwt finalize <branch>");
  });

  test("refuses to finalize a protected branch", async () => {
    const run = await driveFinalize(["main"]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("cannot finalize protected branch 'main'");
  });

  test("reports a branch with no worktree", async () => {
    const run = await driveFinalize(["ghost"]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("no worktree found for branch 'ghost'");
  });

  test("resolves a directory name to the branch checked out in that worktree", async () => {
    featureWorktree();
    const run = await driveFinalize(["feature-x"]);
    expect(run.output).toContain("Resolved 'feature-x' \u2192 branch 'feature/x'");
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Finalized 'feature/x' \u2014 merged to main");
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("feature work");
  });

  test("rejects --gates together with --skip-gates", async () => {
    featureWorktree();

    const run = await driveFinalize(["feature/x", "--gates", "lint", "--skip-gates", "spdx"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("--gates and --skip-gates are mutually exclusive");
  });
});

// --------------------------------------------------------------------------
// Dev-checkout preflight
// --------------------------------------------------------------------------

describe("finalize dev-checkout preflight", () => {
  test("refuses when the dev checkout has unmerged paths", async () => {
    featureWorktree();
    commitFile(root, "seed.txt", "main side\n", "main edit");
    git(["checkout", "-q", "-b", "side", "main~1"]);
    commitFile(root, "seed.txt", "other side\n", "side edit");
    git(["checkout", "-q", "main"]);
    expect(gitExitCode(["merge", "side"])).not.toBe(0);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("dev checkout has unmerged paths");
    expect(run.output).toContain("status  (then resolve or git merge/rebase/cherry-pick --abort)");
  });

  test("refuses when the dev checkout is mid-merge", async () => {
    featureWorktree();
    git(["checkout", "-q", "-b", "side"]);
    commitFile(root, "side.txt", "side\n", "side work");
    git(["checkout", "-q", "main"]);
    expect(gitExitCode(["merge", "--no-commit", "--no-ff", "side"])).toBe(0);
    expect(existsSync(join(root, ".git", "MERGE_HEAD"))).toBe(true);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("dev checkout is mid-merge (MERGE_HEAD exists)");
    expect(run.output).toContain("git merge --abort");
  });

  test("refuses when the dev checkout is mid-rebase", async () => {
    featureWorktree();
    mkdirSync(join(root, ".git", "rebase-merge"));
    writeFileSync(join(root, ".git", "REBASE_HEAD"), `${git(["rev-parse", "HEAD"]).trim()}\n`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("dev checkout is mid-rebase (REBASE_HEAD exists)");
    expect(run.output).toContain("git rebase --abort");
  });

  test("refuses when the dev checkout is mid-cherry-pick", async () => {
    featureWorktree();
    writeFileSync(join(root, ".git", "CHERRY_PICK_HEAD"), `${git(["rev-parse", "HEAD"]).trim()}\n`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("dev checkout is mid-cherry_pick (CHERRY_PICK_HEAD exists)");
    expect(run.output).toContain("git cherry-pick --abort");
  });

  test("ignores an orphan REBASE_HEAD marker and finalizes", async () => {
    featureWorktree();
    writeFileSync(join(root, ".git", "REBASE_HEAD"), `${git(["rev-parse", "HEAD"]).trim()}\n`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.output).toContain("ignoring orphan REBASE_HEAD marker");
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Finalized 'feature/x' \u2014 merged to main");
  });

  test("refuses when the dev checkout has staged-but-uncommitted entries", async () => {
    featureWorktree();
    writeFileSync(join(root, "staged.txt"), "staged\n");
    git(["add", "staged.txt"]);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("dev checkout has 1 staged-but-uncommitted entries");
    expect(run.output).toContain("commit  (or git -C");
  });

  test("warns about leftover finalize stashes and proceeds", async () => {
    featureWorktree();
    writeFileSync(join(root, "seed.txt"), "local scribble\n");
    git(["stash", "push", "-m", "worktree-finalize-leftover"]);

    const run = await driveFinalize(["feature/x"]);

    expect(run.output).toContain("leftover finalize stash(es) from prior crash");
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Finalized 'feature/x' \u2014 merged to main");
  });
});

// --------------------------------------------------------------------------
// Worktree state gate
// --------------------------------------------------------------------------

describe("finalize worktree state gate", () => {
  test("refuses a worktree with unstaged edits", async () => {
    const wtPath = featureWorktree();
    writeFileSync(join(wtPath, "feature.txt"), "edited\n");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("uncommitted changes detected");
    expect(run.output).toContain(`cd ${wtPath} && git add -A && git commit -m 'feat: ...'`);
  });

  test("refuses a worktree with staged-only edits", async () => {
    const wtPath = featureWorktree();
    writeFileSync(join(wtPath, "staged.txt"), "staged\n");
    git(["add", "staged.txt"], wtPath);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("uncommitted changes detected");
  });
});

// --------------------------------------------------------------------------
// Lock acquisition
// --------------------------------------------------------------------------

describe("finalize lock", () => {
  test("refuses when another live process holds the lock", async () => {
    featureWorktree();
    // PID 1 is always live; kill(1, 0) either succeeds or fails EPERM, and
    // both mean "holder alive" to the stale-reap policy.
    writeFileSync(join(root, ".worktree-finalize.lock"), "1");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("could not acquire finalize lock");
    expect(run.output).toContain("Holder: PID 1 (alive)");
    expect(existsSync(join(root, ".worktree-finalize.lock"))).toBe(true);
  });

  test("releases the lock on the success path", async () => {
    featureWorktree();
    const run = await driveFinalize(["feature/x"]);
    expect(run.exitCode).toBeNull();
    expect(existsSync(join(root, ".worktree-finalize.lock"))).toBe(false);
  });

  test("the installed exit hooks release the lock and ledger-gripe a failure", async () => {
    featureWorktree();
    const lockPath = join(root, ".worktree-finalize.lock");
    const preexisting = new Set(process.listeners("exit"));
    let hooksInstalled = 0;
    let lockReleasedWhileHeld = false;

    // Runs after finalize's synchronous setup (lock held, exit hooks
    // installed) and before its cleanup, so those hooks can be driven the way
    // a real process exit would drive them — process.exit itself is stubbed.
    const probe = Promise.resolve().then(() => {
      const hooks = process.listeners("exit").filter((hook) => !preexisting.has(hook));
      hooksInstalled = hooks.length;
      const savedExitCode = process.exitCode;
      process.exitCode = 1; // the failure hook only gripes for exit code 1
      try {
        for (const hook of hooks) (hook as () => void)();
      } finally {
        process.exitCode = savedExitCode;
      }
      lockReleasedWhileHeld = !existsSync(lockPath);
    });

    const run = await driveFinalize(["feature/x"]);
    await probe;

    expect(run.exitCode).toBeNull();
    expect(hooksInstalled).toBeGreaterThan(0);
    expect(lockReleasedWhileHeld).toBe(true);
    expect(readFileSync(join(treeDir, ".ledger.jsonl"), "utf8")).toContain(
      "finalize feature/x failed (exit 1)",
    );
  });
});

// --------------------------------------------------------------------------
// Plan validation gate
// --------------------------------------------------------------------------

describe("finalize plan-validation gate", () => {
  test("fails the run and names the failing gate", async () => {
    const wtPath = featureWorktree();
    mkdirSync(join(wtPath, ".plan"));
    writeFileSync(join(wtPath, ".plan", "notes.md"), "# no license header\n");

    const run = await driveFinalize(["feature/x", "--plan-gates", "spdx"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Plan validation failed");
    expect(run.output).toContain("\u2717 spdx");
    expect(run.output).toContain("missing SPDX-License-Identifier");
    // Refusal happened before the worktree was touched.
    expect(existsSync(wtPath)).toBe(true);
  });

  test("passes the gate and continues when the plan files are clean", async () => {
    const wtPath = featureWorktree();
    mkdirSync(join(wtPath, ".plan"));
    writeFileSync(
      join(wtPath, ".plan", "notes.md"),
      "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n# notes\n",
    );

    const run = await driveFinalize(["feature/x", "--plan-gates", "spdx"]);

    expect(run.output).toContain("Plan validation passed (1 gates)");
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Finalized 'feature/x' \u2014 merged to main");
  });

  test("--force skips the plan gate, the checks and the tests", async () => {
    const wtPath = featureWorktree();
    mkdirSync(join(wtPath, ".plan"));
    writeFileSync(join(wtPath, ".plan", "notes.md"), "# no license header\n");
    withBunLock(wtPath);
    configureCommands("exit 7", "exit 7");

    const run = await driveFinalize(["feature/x", "--plan-gates", "spdx", "--force"]);

    expect(run.exitCode).toBeNull();
    expect(run.output.match(/Skipped: --force flag set/g)?.length).toBe(3);
    expect(run.output).toContain("Finalized 'feature/x' \u2014 merged to main");
  });

  test("a validator error aborts finalize and records a gripe", async () => {
    featureWorktree();

    const run = await driveFinalize(["feature/x", "--plan-gates", "not-a-gate"]);

    expect(run.exitCode).toBeNull();
    expect(run.error?.message).toContain("unknown gate(s) not-a-gate");
    const ledger = readFileSync(join(treeDir, ".ledger.jsonl"), "utf8");
    expect(ledger).toContain("finalize feature/x failed");
    expect(ledger).toContain("unknown gate(s)");
  });

  test("runs the ticket-index gate through the real sync runner", async () => {
    featureWorktree();

    const run = await driveFinalize(["feature/x", "--plan-gates", "tickets"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Plan validation failed");
    expect(run.output).toContain("\u2717 tickets");
    expect(run.output).toContain("ticket index out of sync");
    expect(run.output).toContain("Tickets directory not found");
  });
});

// --------------------------------------------------------------------------
// Check + test gates
// --------------------------------------------------------------------------

describe("finalize check gate", () => {
  test("skips both gate steps when the worktree has no bun.lock", async () => {
    featureWorktree();

    const run = await driveFinalize(["feature/x"]);

    expect(run.output.match(/Skipped: no bun.lock found/g)?.length).toBe(2);
    expect(run.exitCode).toBeNull();
  });

  test("reports a passing check with the resolved diff-base", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("exit 0");

    const run = await driveFinalize(["feature/x"]);

    expect(run.output).toContain("Checks passed (diff-base=");
    expect(run.output).toContain("Tests passed");
    expect(run.exitCode).toBeNull();
  });

  test("fails the run and tails the runner output when no report exists", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("echo 'gate lint exploded'; exit 3");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Checks failed");
    expect(run.output).toContain("Failed checks");
    expect(run.output).toContain("gate lint exploded");
    expect(run.output).toContain("Check log:    (not captured)");
  });

  test("surfaces the runner stderr", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("echo 'unknown gate: nope' >&2; exit 2");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("unknown gate: nope");
  });

  test("lists the failing gates from the check report", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("exit 3");
    mkdirSync(join(wtPath, ".tmp"));
    const reportPath = join(wtPath, ".tmp", "check-report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({
        checks: [
          { name: "lint", passed: false, output: "\nboom: unused import\nmore" },
          { name: "unit", passed: true, output: "ok" },
          { name: "coverage", passed: false, output: "below floor" },
        ],
      }),
    );

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("\u2717 lint");
    expect(run.output).toContain("boom: unused import");
    expect(run.output).toContain("\u2717 coverage");
    expect(run.output).not.toContain("\u2717 unit");
    expect(run.output).toContain(`Check report: ${reportPath}`);
  });

  test("caps the failing-gate list and points at the remainder", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("exit 3");
    mkdirSync(join(wtPath, ".tmp"));
    const checks = Array.from({ length: 12 }, (_, i) => ({
      name: `gate-${i}`,
      passed: false,
      output: "",
    }));
    writeFileSync(join(wtPath, ".tmp", "check-report.json"), JSON.stringify({ checks }));

    const run = await driveFinalize(["feature/x"]);

    expect(run.output).toContain("\u2717 gate-9");
    expect(run.output).not.toContain("\u2717 gate-10");
    expect(run.output).toContain("and 2 more");
  });

  test("falls back to the output tail when the report is corrupt", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("echo 'tail marker'; exit 3");
    mkdirSync(join(wtPath, ".tmp"));
    writeFileSync(join(wtPath, ".tmp", "check-report.json"), "{not json");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("tail marker");
  });

  test("falls back to the tail when every reported check passed", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("echo 'odd but failed'; exit 3");
    mkdirSync(join(wtPath, ".tmp"));
    writeFileSync(
      join(wtPath, ".tmp", "check-report.json"),
      JSON.stringify({ checks: [{ name: "lint", passed: true, output: "fine" }] }),
    );

    const run = await driveFinalize(["feature/x"]);

    expect(run.output).toContain("odd but failed");
    expect(run.output).toContain("Check report: ");
  });

  test("forwards --gates to the check command", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    // Resolve the expected diff-base before finalize removes the worktree.
    const expectedBase = git(["merge-base", "main", "HEAD"], wtPath).trim();
    const run = await driveFinalize(["feature/x", "--gates", "lint"]);

    expect(run.exitCode).toBeNull();
    expect(readFileSync(argsPath, "utf8").trim().split("\n")).toEqual([
      "--diff-base",
      expectedBase,
      "--gates",
      "lint",
    ]);
  });

  test("forwards --skip-gates to the check command", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    await driveFinalize(["feature/x", "--skip-gates", "spdx"]);

    expect(readFileSync(argsPath, "utf8").trim().split("\n").slice(2)).toEqual([
      "--skip-gates",
      "spdx",
    ]);
  });

  test("omits --diff-base when commands.diff_base is disabled", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    config.settings.commands.diffBase = false;
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}\n[ -z "$1" ]`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(readFileSync(argsPath, "utf8").trim()).toBe("");
  });

  test("fails the run when the unit tests fail", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("exit 0", "echo 'FAIL src/x.test.ts'; exit 1");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Tests failed");
    expect(run.output).toContain("Full test log: (not captured)");
    expect(existsSync(wtPath)).toBe(true);
  });

  test("records the check capture and the failing gate in the run record", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("echo 'check marker'; exit 3");
    const recorder = beginRun(config, "finalize", ["feature/x"], null, "feature/x");
    if (!recorder) throw new Error("run-record fixture could not be created");

    try {
      const run = await driveFinalize(["feature/x"]);

      expect(run.exitCode).toBe(1);
      expect(readFileSync(join(recorder.dir, "check.log"), "utf8")).toContain("check marker");
      const meta = JSON.parse(readFileSync(join(recorder.dir, "meta.json"), "utf8")) as {
        outcome: { failedGates: string[]; };
      };
      expect(meta.outcome.failedGates).toEqual(["check"]);
    } finally {
      recorder.finish(1);
    }
  });

  test("records the test capture and the test gate in the run record", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("exit 0", "echo 'test marker'; exit 1");
    const recorder = beginRun(config, "finalize", ["feature/x"], null, "feature/x");
    if (!recorder) throw new Error("run-record fixture could not be created");

    try {
      const run = await driveFinalize(["feature/x"]);

      expect(run.exitCode).toBe(1);
      expect(readFileSync(join(recorder.dir, "test.log"), "utf8")).toContain("test marker");
      expect(run.output).toContain(`Full test log: ${join(recorder.dir, "test.log")}`);
      const meta = JSON.parse(readFileSync(join(recorder.dir, "meta.json"), "utf8")) as {
        outcome: { failedGates: string[]; };
      };
      expect(meta.outcome.failedGates).toEqual(["tests"]);
    } finally {
      recorder.finish(1);
    }
  });
});

// --------------------------------------------------------------------------
// Merge strategies
// --------------------------------------------------------------------------

describe("finalize rebase strategy", () => {
  test("rebases, fast-forwards, removes the worktree and deletes the branch", async () => {
    const wtPath = featureWorktree();

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Step 1: Checking worktree state...");
    expect(run.output).toContain("Worktree clean");
    expect(run.output).toContain("Rebased successfully");
    expect(run.output).toContain("Fast-forward merged");
    expect(run.output).toContain("Worktree removed");
    expect(run.output).toContain("Branch deleted");
    expect(run.output).toContain("Finalized 'feature/x' \u2014 merged to main");
    expect(existsSync(wtPath)).toBe(false);
    expect(gitExitCode(["rev-parse", "--verify", "feature/x"])).not.toBe(0);
    expect(existsSync(join(root, "feature.txt"))).toBe(true);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("feature work");
  });

  test("stops with recovery steps when the rebase conflicts", async () => {
    const wtPath = addWorktree("feature/x");
    commitFile(wtPath, "seed.txt", "branch side\n", "branch edit");
    commitFile(root, "seed.txt", "main side\n", "main edit");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Rebase conflicts");
    expect(run.output).toContain(`cd ${wtPath} && git rebase --continue`);
    expect(existsSync(wtPath)).toBe(true);
  });

  test("stops when the branch has no commits beyond the target", async () => {
    addWorktree("feature/empty");

    const run = await driveFinalize(["feature/empty"]);

    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("has no commits beyond main \u2014 nothing to merge");
  });

  test("stashes a dirty dev checkout and restores it after the merge", async () => {
    featureWorktree();
    writeFileSync(join(root, "seed.txt"), "local edit\n");
    writeFileSync(join(root, "untracked.txt"), "scratch\n");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Stashed dirty dev checkout as 'worktree-finalize-");
    expect(run.output).toContain("Restored stash 'worktree-finalize-");
    expect(readFileSync(join(root, "seed.txt"), "utf8")).toBe("local edit\n");
    expect(readFileSync(join(root, "untracked.txt"), "utf8")).toBe("scratch\n");
    expect(git(["stash", "list"]).trim()).toBe("");
  });

  test("refuses to proceed when the dev checkout cannot be stashed", async () => {
    featureWorktree();
    writeFileSync(join(root, "seed.txt"), "local edit\n");
    // A stale index lock makes `git stash push` fail while the tree stays dirty.
    writeFileSync(join(root, ".git", "index.lock"), "");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("failed to stash dirty dev checkout");
  });

  test("warns but still succeeds when the worktree cannot be removed", async () => {
    const wtPath = featureWorktree();
    git(["worktree", "lock", wtPath]);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Failed to remove worktree \u2014 remove manually");
    expect(run.output).toContain("Branch deleted (forced)");
    expect(run.output).toContain("Finalized 'feature/x' \u2014 merged to main");
    // The teardown logs are optimistic: git refuses to delete a branch that is
    // still checked out in the surviving worktree, so the branch survives.
    expect(existsSync(wtPath)).toBe(true);
    expect(gitExitCode(["rev-parse", "--verify", "feature/x"])).toBe(0);
  });
});

describe("finalize direct strategy", () => {
  test("refuses without --force", async () => {
    featureWorktree();

    const run = await driveFinalize(["feature/x", "--merge-strategy", "direct"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Direct merge strategy");
    expect(run.output).toContain("Aborted. Use --force to proceed with direct merge");
  });

  test.skipIf(!gpgTooling)(
    "verifies the merge signature and refuses an unsigned commit",
    async () => {
      featureWorktree();
      commitFile(root, "main.txt", "main\n", "main work");
      config.agentGpgKeyId = gpgKeyId;

      const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "direct", "--force"]);

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain("refusing to finalize");
      expect(run.output).toContain("is unsigned");
    },
  );

  test.skipIf(!gpgTooling)(
    "reports a conflicted direct merge and preserves the dev stash",
    async () => {
      const wtPath = addWorktree("feature/x");
      commitFile(wtPath, "seed.txt", "branch side\n", "branch edit");
      commitFile(root, "seed.txt", "main side\n", "main edit");
      writeFileSync(join(root, "untracked.txt"), "scratch\n");
      config.agentGpgKeyId = gpgKeyId;

      const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "direct", "--force"]);

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain("Stashed dirty dev checkout as 'worktree-finalize-");
      expect(run.output).toContain("Merge conflicts \u2014 resolve on main");
      // A pop onto the conflicted dev tree cannot succeed, so the entry stays.
      expect(git(["stash", "list"])).toContain("worktree-finalize-");
    },
  );

  test.skipIf(!gpgTooling)("lands a GPG-signed direct merge end to end", () => {
    featureWorktree();
    commitFile(root, "main.txt", "main\n", "main work");

    // A child process is required here: gpgMergeFlags() spawns gpg WITHOUT an
    // explicit env, so it sees only the startup environment snapshot. Giving
    // the child GNUPGHOME makes the signing key visible to the merge, which is
    // the production path (signed merge + verify-commit) rather than the
    // unsigned fallback the in-process tests exercise.
    const code = [
      `import { finalize } from ${JSON.stringify(resolve(import.meta.dir, "finalize.ts"))};`,
      `import { credentials } from ${
        JSON.stringify(resolve(import.meta.dir, "../utils/credentials.ts"))
      };`,
      `credentials.found = true;`,
      `credentials.keyId = ${JSON.stringify(gpgKeyId)};`,
      `await finalize(["feature/x", "--merge-strategy", "direct", "--force"], {`,
      `  repoRoot: ${JSON.stringify(root)},`,
      `  worktreeRoot: ${JSON.stringify(root)},`,
      `  treeDir: ${JSON.stringify(treeDir)},`,
      `  agentGpgKeyId: ${JSON.stringify(gpgKeyId)},`,
      `  settings: ${JSON.stringify(DEFAULT_SETTINGS)},`,
      `});`,
    ].join("\n");
    const child = Bun.spawnSync([process.execPath, "-e", code], {
      cwd: root,
      env: { ...isolatedGitEnv(), GNUPGHOME: gpgHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = child.stdout.toString() + child.stderr.toString();

    expect(child.exitCode).toBe(0);
    expect(output).toContain("Merge commit GPG-signed (");
    expect(output).toContain("Finalized 'feature/x' \u2014 merged to main");
    const verdict = Bun.spawnSync(["git", "-C", root, "log", "-1", "--format=%G?"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...isolatedGitEnv(), GNUPGHOME: gpgHome },
    });
    expect(verdict.stdout.toString().trim()).toBe("G");
  });
});

describe("finalize squash strategy", () => {
  test("refuses when no agent GPG credentials are loaded", async () => {
    featureWorktree();

    const run = await driveWithoutGpgCredentials(["feature/x", "--merge-strategy", "squash"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("No agent GPG credentials loaded");
  });

  test.skipIf(!gpgTooling)(
    "squash merges with a conventional message and force-deletes",
    async () => {
      featureWorktree();
      config.agentGpgKeyId = gpgKeyId;

      const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "squash"]);

      expect(run.exitCode).toBeNull();
      expect(run.output).toContain("Squash merged: feat: X");
      // A squash merge leaves the branch unmerged from git's point of view, so
      // the safe delete fails and finalize falls back to `branch -D`.
      expect(run.output).toContain("Branch deleted (forced)");
    },
  );

  test.skipIf(!gpgTooling)("rolls dev back to HEAD when the stash pop conflicts", async () => {
    const wtPath = addWorktree("feature/x");
    commitFile(wtPath, "seed.txt", "branch side\n", "branch edit");
    writeFileSync(join(root, "seed.txt"), "local scribble\n");
    config.agentGpgKeyId = gpgKeyId;

    const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "squash"]);

    expect(run.output).toContain("stash pop conflicted \u2014 resetting dev to post-merge HEAD");
    expect(run.output).toContain("preserved");
    expect(run.output).toContain("Your pre-merge work is still on the stash stack");
    expect(git(["stash", "list"])).toContain("worktree-finalize-");
    expect(readFileSync(join(root, "seed.txt"), "utf8")).toBe("seed\n");
  });

  test.skipIf(!gpgTooling)("fails the run when the squash merge itself fails", async () => {
    featureWorktree();
    config.agentGpgKeyId = gpgKeyId;
    // A stale index lock makes `git merge --squash` fail after the GPG gate.
    writeFileSync(join(root, ".git", "index.lock"), "");

    const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "squash"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Squash merge failed");
  });
});
