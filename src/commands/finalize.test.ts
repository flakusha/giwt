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
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { branchToPath, type WorktreeConfig } from "../utils/config";
import { credentials } from "../utils/credentials";
import { isolatedGitEnv } from "../utils/git";
import { readLedger } from "../utils/ledger";
import { setLogLevel, setOutputFormat } from "../utils/output";
import { beginRun } from "../utils/runlog";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { finalize } from "./finalize";
import { installFailureGripe } from "./finalize/checks";
import {
  installSignalHandlers,
  publishActiveLockRelease,
  setMergeInProgress,
  uninstallSignalHandlers,
} from "./finalize/state";
import { teardownFinalizedWorktree } from "./finalize/teardown";

// Check-fanout slots must stay hermetic: these tests drive the real
// finalize() in-process, so Step 2's slot acquisition would otherwise write
// into the developer's ~/.cache. Fixed throwaway slot root + zero wait.
process.env.GIWT_CHECK_SLOT_DIR = join(tmpdir(), `giwt-check-slots-test-${process.pid}`);
process.env.GIWT_CHECK_SLOT_WAIT_MS = "0";

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
  // The staging merge targets the configured root branch (--onto ||
  // settings root) — point the fixture's root at the branch it actually
  // creates so finalize integrates onto main.
  config.settings.branches.root = "main";
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

    // Exhaustion contract: after the 1s fast path the refuser takes a queue
    // ticket; a zero wait budget makes the queue give up immediately (the
    // pre-queue behavior) instead of waiting the 30min production default
    // behind the eternally-alive PID 1.
    process.env.GIWT_FINALIZE_QUEUE_WAIT_MS = "0";
    let run: FinalizeRun;
    try {
      run = await driveFinalize(["feature/x"]);
    } finally {
      delete process.env.GIWT_FINALIZE_QUEUE_WAIT_MS;
    }

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("could not acquire finalize lock");
    expect(run.output).toContain("Holder: PID 1 (alive)");
    expect(run.output).toContain("gave up after");
    expect(existsSync(join(root, ".worktree-finalize.lock"))).toBe(true);
    // The refuser's own ticket is dequeued on the give-up path; only the
    // untouched holder lockfile remains (the queue dir may linger, empty).
    const queueDir = join(root, ".worktree-finalize.lock.queue");
    expect(existsSync(queueDir) ? readdirSync(queueDir) : []).toEqual([]);
  });

  test("releases the lock on the success path", async () => {
    featureWorktree();
    const run = await driveFinalize(["feature/x"]);
    expect(run.exitCode).toBeNull();
    expect(existsSync(join(root, ".worktree-finalize.lock"))).toBe(false);
  });

  test("a merge-phase failure releases the lock and ledger-gripes", async () => {
    // Since the lock narrowed to the merge phase (runMergePhase), the exit
    // hooks only exist inside that synchronous span — a probe cannot fire
    // there. The safety property the old probe verified (no lock leak on a
    // mid-flight failure, failure recorded) is exercised end-to-end here:
    // diverge main against the feature tip so the Step-5a rebase conflicts
    // and the merge path calls process.exit(1) from inside the locked span;
    // the release must still run.
    featureWorktree();
    commitFile(root, "feature.txt", "main rewrites the file\n", "main moves feature.txt");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Rebase conflicts");
    expect(existsSync(join(root, ".worktree-finalize.lock"))).toBe(false);
    expect(readFileSync(join(treeDir, ".ledger.jsonl"), "utf8")).toContain(
      "finalize feature/x failed",
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

  test("check gate holds and releases a cross-instance fan-out slot", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    const slotRoot = process.env.GIWT_CHECK_SLOT_DIR!;
    const acquired = join(toolsDir, "slot-acquired");
    rmSync(slotRoot, { recursive: true, force: true });
    // The check child is a separate process and the parent blocks in
    // Bun.spawnSync, so the CHILD is the only witness that the slot was held
    // during the gate storm; the post-run assertions prove the release.
    configureCommands(`[ -d "${slotRoot}/0" ] && touch "${acquired}"`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(existsSync(acquired)).toBe(true);
    expect(existsSync(join(slotRoot, "0"))).toBe(false);
  });

  test("proceeds with a warn when all check-fanout slots are busy", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("exit 0");
    // Capacity 1 (4096 MB / 4096 MB per tree): the pre-held slot exhausts it.
    config.settings.doctor.memoryBudgetMb = 4096;
    const slotRoot = process.env.GIWT_CHECK_SLOT_DIR!;
    rmSync(slotRoot, { recursive: true, force: true });
    mkdirSync(join(slotRoot, "0"), { recursive: true });

    const run = await driveFinalize(["feature/x"]);

    // Contention shapes, it never blocks: the check gate still runs and the
    // finalize completes.
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("check-fanout slots busy");
    expect(run.output).toContain("Checks passed");
    // The pre-held foreign slot is left alone (not ours to release).
    expect(existsSync(join(slotRoot, "0"))).toBe(true);
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

  test("lists failing gates when the report uses the real runner schema (command, not name)", async () => {
    // Regression: BUG-finalize-check-failure-report-never-names-failed-gates-check.
    // The loop-lore check runner (schemaVersion 1) identifies checks by
    // `command` and writes `output: null` for quiet checks. The old filter
    // (check.name only) matched nothing, so finalize degraded to a raw
    // stdout tail and never named the failed gate.
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands("echo 'PASS lint'; exit 3");
    mkdirSync(join(wtPath, ".tmp"));
    const reportPath = join(wtPath, ".tmp", "check-report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        runner: "loop-lore-check",
        passed: false,
        exitCode: 3,
        checks: [
          {
            command: "bun run typecheck",
            passed: true,
            exitCode: 0,
            durationMs: 4980,
            output: null,
            truncated: false,
          },
          {
            command: "bun run check:code-map",
            passed: false,
            exitCode: 1,
            durationMs: 312,
            output: "code-map stale: src/commands/clean.ts missing from index\n1 gate failed",
            truncated: false,
          },
        ],
        nonBlocking: [],
      }),
    );

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("\u2717 bun run check:code-map");
    expect(run.output).toContain("code-map stale: src/commands/clean.ts missing from index");
    expect(run.output).not.toContain("\u2717 bun run typecheck");
    expect(run.output).not.toContain("PASS lint\n");
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
    expect(run.output).toContain("no failing gate found in the check report");
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
    // resolveDiffBase returns the requested target verbatim (BUG-resolvediffbase).
    const expectedBase = "main";
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

  test("forwards --jobs to the check command", async () => {
    // Check runners default the gate fan-out to 1; --jobs is the explicit
    // opt-in to a faster (memory-hungry) run, so it must reach the runner.
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    await driveFinalize(["feature/x", "--jobs", "4"]);

    expect(readFileSync(argsPath, "utf8").trim().split("\n").slice(2)).toEqual([
      "--jobs",
      "4",
    ]);
  });

  test("omits --jobs when the caller did not opt in", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    await driveFinalize(["feature/x"]);

    expect(readFileSync(argsPath, "utf8")).not.toContain("--jobs");
  });

  test("forwards --gates and --jobs together", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    await driveFinalize(["feature/x", "--gates", "lint", "--jobs", "2"]);

    expect(readFileSync(argsPath, "utf8").trim().split("\n").slice(2)).toEqual([
      "--gates",
      "lint",
      "--jobs",
      "2",
    ]);
  });

  test("forwards a display-name gates csv verbatim as argv (no re-splitting)", async () => {
    // Ticket FIX-gates-accepts-ambiguous-display-names: the csv values can
    // contain spaces, dashes, commas and parens — they must reach the check
    // command as ONE argv token, never split or entangled with --diff-base.
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    // resolveDiffBase returns the requested target verbatim (BUG-resolvediffbase).
    const expectedBase = "main";
    const csv = "format - dprint,dead - code (knip),typecheck — backend";
    const run = await driveFinalize(["feature/x", "--gates", csv]);

    expect(run.exitCode).toBeNull();
    expect(readFileSync(argsPath, "utf8").trim().split("\n")).toEqual([
      "--diff-base",
      expectedBase,
      "--gates",
      csv,
    ]);
  });

  test("caps the failing test output tail and points at the full log", async () => {
    // Ticket FEAT-bounded-output-mode-for-check-and-test-streams: a failing
    // test stream prints only the last output.stream_tail lines on console.
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    const sixty = "i=1; while [ $i -le 60 ]; do echo \"line-$i\"; i=$((i+1)); done";
    configureCommands("exit 0", `${sixty}; exit 1`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Failed tests");
    expect(run.output).toContain("  line-60");
    expect(run.output).toContain("  line-36");
    expect(run.output).not.toContain("  line-35");
    expect(run.output).toContain("Full test log: ");
  });

  test("test tail honors output.stream_tail from settings", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    config.settings.output.streamTail = 2;
    configureCommands("exit 0", "echo early; echo mid; echo last; exit 1");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("  mid");
    expect(run.output).toContain("  last");
    expect(run.output).not.toContain("  early");
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
    expect(run.output).toContain("main moved to");
    expect(run.output).toContain("dev checkout synced to main");
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
    expect(run.output).toContain("resolve in the staging worktree");
    expect(run.output).toContain("git rebase --continue");
    // The source worktree is untouched; the staging worktree holds the
    // conflict state for resolution.
    expect(existsSync(wtPath)).toBe(true);
  });

  test("tears down the worktree and branch when the target already contains them", async () => {
    const wtPath = addWorktree("feature/empty");

    const run = await driveFinalize(["feature/empty"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("has no commits beyond main \u2014 nothing to merge");
    // Nothing merges or reconciles when there is nothing to merge.
    expect(run.output).not.toContain("Step 5a");
    expect(run.output).not.toContain("Step 5.5");
    // Teardown is the contract: worktree dir, admin entry, and branch ref go.
    expect(run.output).toContain("Worktree removed");
    expect(run.output).toContain("Branch deleted");
    expect(run.output).toContain("Finalized 'feature/empty' \u2014 already contained in main");
    expect(existsSync(wtPath)).toBe(false);
    expect(gitExitCode(["rev-parse", "--verify", "feature/empty"])).not.toBe(0);
  });

  test("still refuses a dirty already-merged worktree at Step 1", async () => {
    const wtPath = addWorktree("feature/empty");
    // Tracked modification: `git diff --quiet` ignores untracked files.
    writeFileSync(join(wtPath, "seed.txt"), "dirty\n");

    const run = await driveFinalize(["feature/empty"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("uncommitted changes detected");
    expect(existsSync(wtPath)).toBe(true);
    expect(gitExitCode(["rev-parse", "--verify", "feature/empty"])).toBe(0);
  });

  test("closes scoped issues and reconciles the plan on a normal finalize", async () => {
    const wtPath = featureWorktree();
    // Scope marker lives in the linked worktree's git dir, not the tree.
    const gitDir = resolve(wtPath, git(["rev-parse", "--git-dir"], wtPath).trim());
    writeFileSync(
      join(gitDir, "giwt-scoped.json"),
      `${JSON.stringify({ tickets: ["FEAT-DEMO"] })}\n`,
    );
    // Minimal plan state so Step 5.5's runSync --fix has something to stage.
    // Deliberately NOT committed: the file is ignored (global dot-dir
    // ignore), so it does not dirty the dev snapshot for the lazy sync, and
    // reconcileScopedPlan's `add -f` stages it as the reconciliation payload.
    mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
    writeFileSync(join(root, ".plan", "tickets", "index.json"), "{}\n");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Scoped worktree: closing 1 ticket issue(s)...");
    expect(run.output).toContain("Step 5.5: scoped-worktree plan reconciliation...");
    // The unresolvable extid is tolerated (warn), the reconciliation lands.
    expect(run.output).toContain("could not resolve FEAT-DEMO in the registry");
    expect(git(["log", "-1", "--format=%s"]).trim())
      .toBe("chore(plan): scoped-worktree reconciliation");
    expect(existsSync(wtPath)).toBe(false);
  });

  test("keeps a dirty dev checkout dirty — the merge happens in staging", async () => {
    featureWorktree();
    writeFileSync(join(root, "seed.txt"), "local edit\n");
    writeFileSync(join(root, "untracked.txt"), "scratch\n");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("not fast-forwarded to main (dirty working tree)");
    expect(run.output).toContain("main moved to");
    // The user's dirt is untouched — never stashed, never reset.
    expect(readFileSync(join(root, "seed.txt"), "utf8")).toBe("local edit\n");
    expect(readFileSync(join(root, "untracked.txt"), "utf8")).toBe("scratch\n");
    expect(git(["stash", "list"]).trim()).toBe("");
    // The target ref moved even though dev did not.
    expect(git(["log", "-1", "--format=%s", "main"]).trim()).toBe("feature work");
  });

  test("merges in staging even when the dev checkout cannot be touched", async () => {
    featureWorktree();
    writeFileSync(join(root, "seed.txt"), "local edit\n");
    // A stale index lock makes any dev-side index write (stash push, merge)
    // fail — the staging path must not care about dev's git state.
    writeFileSync(join(root, ".git", "index.lock"), "");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("main moved to");
    expect(git(["log", "-1", "--format=%s", "main"]).trim()).toBe("feature work");
  });

  // Intentional contract change from
  // BUG-finalize-teardown-worktree-removal-failure-is-non-fatal: a failed
  // worktree removal now fails the whole run (exit 1, no branch delete, no
  // success summary) instead of warning and continuing.
  test("fails finalize when the worktree cannot be removed", async () => {
    const wtPath = featureWorktree();
    git(["worktree", "lock", wtPath]);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("Failed to remove worktree");
    expect(run.output).toContain(`Remove manually: git worktree remove ${wtPath}`);
    // Step 7 (branch deletion) and the success summary never ran.
    expect(run.output).not.toContain("Branch deleted");
    expect(run.output).not.toContain("Finalized '");
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
    "discards staging and leaves the target untouched when the direct merge conflicts",
    async () => {
      const wtPath = addWorktree("feature/x");
      commitFile(wtPath, "seed.txt", "branch side\n", "branch edit");
      commitFile(root, "seed.txt", "main side\n", "main edit");
      writeFileSync(join(root, "untracked.txt"), "scratch\n");
      config.agentGpgKeyId = gpgKeyId;

      const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "direct", "--force"]);

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain("Direct merge conflicts — staging discarded, main untouched");
      // Dev was never involved: no stash dance, scratch file untouched.
      expect(git(["stash", "list"]).trim()).toBe("");
      expect(readFileSync(join(root, "untracked.txt"), "utf8")).toBe("scratch\n");
      // The target ref did not move; a retry is unblocked.
      expect(git(["log", "-1", "--format=%s", "main"]).trim()).toBe("main edit");
      expect(gitExitCode(["rev-parse", "--verify", "feature/x"])).toBe(0);
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
      `  settings: ${
        JSON.stringify({
          ...DEFAULT_SETTINGS,
          branches: { ...DEFAULT_SETTINGS.branches, root: "main" },
        })
      },`,
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

  test.skipIf(!gpgTooling)(
    "creates a merge commit instead of fast-forwarding when the branch is FF-able",
    () => {
      // No commit on main after branching: the merge is fast-forwardable,
      // which must NOT happen — the direct strategy's contract is a
      // GPG-signed merge commit (BUG-finalize-direct-merge-allows-fast-forward).
      featureWorktree("feature/ff");

      const code = [
        `import { finalize } from ${JSON.stringify(resolve(import.meta.dir, "finalize.ts"))};`,
        `import { credentials } from ${
          JSON.stringify(resolve(import.meta.dir, "../utils/credentials.ts"))
        };`,
        `credentials.found = true;`,
        `credentials.keyId = ${JSON.stringify(gpgKeyId)};`,
        `await finalize(["feature/ff", "--merge-strategy", "direct", "--force"], {`,
        `  repoRoot: ${JSON.stringify(root)},`,
        `  worktreeRoot: ${JSON.stringify(root)},`,
        `  treeDir: ${JSON.stringify(treeDir)},`,
        `  agentGpgKeyId: ${JSON.stringify(gpgKeyId)},`,
        `  settings: ${
          JSON.stringify({
            ...DEFAULT_SETTINGS,
            branches: { ...DEFAULT_SETTINGS.branches, root: "main" },
          })
        },`,
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
      // A merge commit has two parents; a fast-forward would have none.
      const parents = Bun.spawnSync(["git", "-C", root, "rev-parse", "--verify", "HEAD^2"], {
        stdout: "pipe",
        stderr: "pipe",
        env: isolatedGitEnv(),
      });
      expect(parents.exitCode).toBe(0);
    },
  );
});

describe("finalize detached dev checkout", () => {
  test("warns and stays when the dev checkout HEAD is detached", async () => {
    const wtPath = featureWorktree();
    git(["checkout", "-q", "--detach"]);

    const run = await driveFinalize(["feature/x"]);

    // The staging merge no longer requires dev to hold the target: it
    // succeeds, the target ref moves, and dev stays detached with a warning.
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("dev checkout not fast-forwarded to main (on detached HEAD)");
    expect(run.output).toContain("main moved to");
    expect(git(["log", "-1", "--format=%s", "main"]).trim()).toBe("feature work");
    // Dev's checkout content did not change (still at the old main).
    expect(existsSync(join(root, "feature.txt"))).toBe(false);
    expect(existsSync(wtPath)).toBe(false);
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

  test.skipIf(!gpgTooling)("keeps a dirty dev checkout dirty through a squash merge", async () => {
    const wtPath = addWorktree("feature/x");
    commitFile(wtPath, "seed.txt", "branch side\n", "branch edit");
    writeFileSync(join(root, "seed.txt"), "local scribble\n");
    config.agentGpgKeyId = gpgKeyId;

    const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "squash"]);

    // The old flow stashed, squash-merged in dev, then reset dev on stash-pop
    // conflict. Staging never touches dev: the dirt survives verbatim and the
    // squash commit lands on the target ref regardless.
    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Squash merged: feat: X");
    expect(run.output).toContain("not fast-forwarded to main (dirty working tree)");
    expect(readFileSync(join(root, "seed.txt"), "utf8")).toBe("local scribble\n");
    expect(git(["stash", "list"]).trim()).toBe("");
    expect(git(["log", "-1", "--format=%s", "main"]).trim()).toBe("feat: X");
  });

  test.skipIf(!gpgTooling)(
    "squash merges in staging even when the dev index is locked",
    async () => {
      featureWorktree();
      config.agentGpgKeyId = gpgKeyId;
      // A stale index lock makes any dev-side index write fail — staging
      // must not care about dev's git state.
      writeFileSync(join(root, ".git", "index.lock"), "");

      const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "squash"]);

      expect(run.exitCode).toBeNull();
      expect(run.output).toContain("Squash merged: feat: X");
      expect(git(["log", "-1", "--format=%s", "main"]).trim()).toBe("feat: X");
    },
  );

  test.skipIf(!gpgTooling)(
    "leaves the target untouched and retry unblocked when the squash commit fails",
    async () => {
      featureWorktree();
      config.agentGpgKeyId = gpgKeyId;
      // A failing pre-commit hook makes `git commit -F` fail AFTER
      // `git merge --squash` successfully staged the integration (the hook
      // is shared via the common git dir, so staging runs it too).
      writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n");
      chmodSync(join(root, ".git", "hooks", "pre-commit"), 0o755);

      const run = await driveGpgFinalize(["feature/x", "--merge-strategy", "squash"]);

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain("Squash commit failed");
      expect(run.output).toContain("the target ref is untouched");
      // Nothing landed: main is still at seed, dev untouched, and the branch
      // survives for a plain retry.
      expect(git(["log", "-1", "--format=%s", "main"]).trim()).toBe("seed");
      expect(git(["status", "--porcelain"], root)).toBe("");
      expect(gitExitCode(["rev-parse", "--verify", "feature/x"])).toBe(0);
    },
  );
});

// --------------------------------------------------------------------------
// Teardown lifecycle regressions (untracked gate, cherry-pick, missing wt,
// fatal removal)
// --------------------------------------------------------------------------

describe("finalize teardown lifecycle regressions", () => {
  test("refuses a worktree with untracked files", async () => {
    const wtPath = featureWorktree();
    writeFileSync(join(wtPath, "scratch.txt"), "untracked\n");

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("untracked files detected");
    expect(run.output).toContain("scratch.txt");
    // Refusal happens before any teardown: nothing was destroyed.
    expect(existsSync(wtPath)).toBe(true);
    expect(gitExitCode(["rev-parse", "--verify", "feature/x"])).toBe(0);
  });

  test("treats a cherry-picked branch as already merged and force-deletes with a reflog warning", async () => {
    const wtPath = featureWorktree("feature/pick");
    const sha = git(["rev-parse", "HEAD"], wtPath).trim();
    // Land the same patch on main under a DIFFERENT SHA: pin ancient
    // commit dates, because a cherry-pick in the same second as the
    // original commit reproduces the identical SHA (same tree, parent,
    // message, timestamps) and would make the branch trivially merged.
    const pick = Bun.spawnSync(["git", "-C", root, "cherry-pick", sha], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...isolatedGitEnv(),
        GIT_AUTHOR_DATE: "2005-04-07T22:13:13+00:00",
        GIT_COMMITTER_DATE: "2005-04-07T22:13:13+00:00",
      },
    });
    if (pick.exitCode !== 0) {
      throw new Error(`cherry-pick failed: ${pick.stderr.toString()}`);
    }
    const pickedSha = git(["rev-parse", "main"]).trim();
    expect(pickedSha).not.toBe(sha);

    const run = await driveFinalize(["feature/pick"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("patch-equivalent to main (cherry-picked?)");
    // Different SHAs mean the safe delete refuses; the forced fallback must
    // disclose the discarded tip for reflog recovery.
    expect(run.output).toContain("branch -d refused:");
    expect(run.output).toMatch(/tip [0-9a-f]{40} recoverable from reflog/);
    expect(run.output).toContain("Branch deleted (forced)");
    expect(existsSync(wtPath)).toBe(false);
    expect(gitExitCode(["rev-parse", "--verify", "feature/pick"])).not.toBe(0);
  });

  test("prunes stale registration when the worktree was removed externally", async () => {
    const wtPath = featureWorktree("feature/gone");
    rmSync(wtPath, { recursive: true, force: true });

    const run = await driveFinalize(["feature/gone"]);

    expect(run.exitCode).toBeNull();
    expect(run.output).toContain("Worktree missing — skipping clean-state checks");
    expect(run.output).toContain("Worktree already removed externally");
    // The branch commit is unmerged, so the forced fallback discloses the tip.
    expect(run.output).toContain("branch -d refused:");
    expect(run.output).toContain("Branch deleted (forced)");
    expect(run.output).toContain("already contained in main");
    expect(existsSync(wtPath)).toBe(false);
    expect(gitExitCode(["rev-parse", "--verify", "feature/gone"])).not.toBe(0);
    // The stale admin entry is pruned, not leaked.
    expect(git(["worktree", "list"])).not.toContain("feature/gone");
  });

  test("exits 1 without success summary when the worktree cannot be removed", () => {
    const wtPath = featureWorktree("feature/stuck");
    // Sabotage: drop the .git/worktrees admin entry so the dir is no longer
    // a registered worktree and `git worktree remove` fails with "is not a
    // working tree" while the branch ref still exists.
    const gitDir = git(["rev-parse", "--git-dir"], wtPath).trim();
    rmSync(gitDir, { recursive: true, force: true });

    const chunks: string[] = [];
    const push = (chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    };
    const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
    const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
    let exitCode: number | null = null;
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        exitCode = code ?? 0;
        throw new Error(`__exit__:${code}`);
      }) as typeof process.exit,
    );
    let error: Error | null = null;
    try {
      teardownFinalizedWorktree("feature/stuck", wtPath, config, false, "main");
    } catch (err) {
      error = err as Error;
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
    const output = chunks.join("");

    // Widen: TS narrows `exitCode` to null since the only write happens
    // inside the process.exit mock callback.
    expect(exitCode as number | null).toBe(1);
    expect(error).not.toBeNull();
    expect(output).toContain("Failed to remove worktree:");
    expect(output).toContain(`Remove manually: git worktree remove ${wtPath}`);
    // Step 7 and the success summary never ran.
    expect(output).not.toContain("Branch deleted");
    expect(output).not.toContain("Finalized '");
    expect(gitExitCode(["rev-parse", "--verify", "feature/stuck"])).toBe(0);
    // The failure was appended to the ledger as a gripe.
    const ledger = readLedger(config.treeDir, 10);
    expect(ledger.some((record) => record.msg.includes("failed to remove worktree"))).toBe(true);
  });
});

describe("merge-phase lock narrowing (FEAT-narrow-finalize-lock-to-merge-steps)", () => {
  test("gates run without holding the finalize lock", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    // Probe the lockfile from INSIDE the Step-2 gate: the check script is a
    // subprocess, so it observes the real on-disk lock state of the dev
    // checkout while the gate storm is in flight.
    const probePath = join(toolsDir, "lock-probe.txt");
    const lockPath = join(root, ".worktree-finalize.lock");
    configureCommands(
      `if [ -f "${lockPath}" ]; then echo locked; else echo unlocked; fi > "${probePath}"`,
    );

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBeNull();
    expect(readFileSync(probePath, "utf8").trim()).toBe("unlocked");
  });

  test("refuses the merge when dev turned dirty mid-gates, and releases the lock", async () => {
    const wtPath = featureWorktree();
    withBunLock(wtPath);
    // The pre-lock checkDevMergeable passes on a clean dev checkout; the
    // check gate then stages a file in the dev checkout. The under-lock
    // re-check must refuse (previously the merge stashed straight through
    // this state); the refusal path must still release the lock.
    configureCommands(`echo late > "${join(root, "late.txt")}" && git -C "${root}" add late.txt`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("staged-but-uncommitted");
    expect(existsSync(join(root, ".worktree-finalize.lock"))).toBe(false);
  });

  test("the exit hook releases a published lock on any termination path", () => {
    // In-process exerciser for releaseLockOnExit (the child-process fixture
    // covers the real-exit semantics but does not count toward coverage):
    // publish a release, install the hooks, drive the `exit` listeners the
    // way Node would on process.exit/signal/unhandled-throw, and observe
    // the release fire exactly once.
    const preExit = process.listeners("exit");
    const savedSignals = FINALIZE_SIGNALS.map((sig) => [sig, process.listeners(sig)] as const);
    let released = 0;
    try {
      publishActiveLockRelease(() => {
        released++;
      });
      installSignalHandlers();
      const hooks = process.listeners("exit").filter((hook) => !preExit.includes(hook));
      expect(hooks.length).toBeGreaterThan(0);
      for (const hook of hooks) (hook as () => void)();
      expect(released).toBe(1);
    } finally {
      publishActiveLockRelease(null);
      uninstallSignalHandlers();
      process.removeAllListeners("exit");
      for (const listener of preExit) process.on("exit", listener as () => void);
      for (const [sig, listeners] of savedSignals) {
        process.removeAllListeners(sig);
        for (const listener of listeners) process.on(sig, listener as () => void);
      }
    }
  });

  test("the signal handler rolls back merge state and exits 130", () => {
    // In-process exerciser for handleSignalAbort (the child-process signal
    // fixture proves the real-exit semantics; this covers the handler body
    // for the coverage ratchet). With merge state published, a SIGHUP must
    // attempt the rollback and exit with the signal code.
    const exits: number[] = [];
    // Record-only stub: a throwing stub escapes Bun's emit asynchronously
    // and fails the test from outside the try/catch. handleSignalAbort's
    // post-exit code is unreachable in production anyway.
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        exits.push(code ?? 0);
      }) as typeof process.exit,
    );
    const savedSignals = FINALIZE_SIGNALS.map((sig) => [sig, process.listeners(sig)] as const);
    const savedExit = process.listeners("exit");
    try {
      setMergeInProgress(root, "feature/x", "0".repeat(40), null, true);
      installSignalHandlers();

      // Bun's process.emit does not propagate listener throws synchronously;
      // the sentinel (if thrown) surfaces uncaught — the exit call record is
      // the assertion surface either way.
      try {
        process.emit("SIGHUP");
      } catch { /* sentinel from the exit stub */ }
      expect(exits).toEqual([130]);
    } finally {
      exitSpy.mockRestore();
      uninstallSignalHandlers();
      process.removeAllListeners("exit");
      for (const listener of savedExit) process.on("exit", listener as () => void);
      for (const [sig, listeners] of savedSignals) {
        process.removeAllListeners(sig);
        for (const listener of listeners) process.on(sig, listener as () => void);
      }
    }
  });

  test("the exit-hook failure gripe records exit-1 finalize failures", () => {
    // Second half of the old probe test: the failure-gripe exit hook only
    // gripes for exit code 1 and appends to the tree ledger.
    const savedExit = process.listeners("exit");
    const savedCode = process.exitCode;
    try {
      installFailureGripe(treeDir, () => "feature/gripe");
      process.exitCode = 1;
      const hooks = process.listeners("exit").filter((hook) => !savedExit.includes(hook));
      expect(hooks.length).toBeGreaterThan(0);
      for (const hook of hooks) (hook as () => void)();
      expect(readFileSync(join(treeDir, ".ledger.jsonl"), "utf8")).toContain(
        "finalize feature/gripe failed (exit 1)",
      );
    } finally {
      process.exitCode = typeof savedCode === "number" ? savedCode : 0;
      process.removeAllListeners("exit");
      for (const listener of savedExit) process.on("exit", listener as () => void);
    }
  });
});
