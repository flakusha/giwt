// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the native-backend finalize path (src/commands/finalize.ts:
 * the jj/pijul dispatch + `runNativeFinalize`).
 *
 * The native path drives the backend CLIs through the default spawn seams
 * (`defaultJjSpawn` / `defaultPijulSpawn`), which shell out via
 * `Bun.spawnSync`. The fixtures therefore stub `Bun.spawnSync` for the
 * `jj` / `pijul` argv[0] only (the pattern used by src/commands/jj.test.ts)
 * and delegate every other command to the real spawn — no real backend
 * binary is ever executed, and the real spawn is restored in afterEach.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { branchToPath, type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel, setOutputFormat } from "../utils/output";
import { beginRun, finishActiveRun } from "../utils/runlog";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { finalize } from "./finalize";

// Check-fanout slots must stay hermetic: the native gate path holds a slot.
// The slot root is owned per test run (own name, own pid) and installed in
// beforeEach, so this file never shares — or deletes — another test file's
// slot directory, whatever the file load order is.
const SLOT_DIR = join(scratchRoot(), `giwt-check-slots-native-test-${process.pid}`);
let savedSlotDir: string | undefined;
let savedSlotWait: string | undefined;

const realSpawnSync = Bun.spawnSync;

let root: string;
let treesRoot: string;
let treeDir: string;
let toolsRoot: string;
let toolsDir: string;
/** File the fake check command writes its argv into. */
let argsPath: string;
let config: WorktreeConfig;
/** argv of every stubbed backend CLI call, in order. */
let backendCalls: string[] = [];

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

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

/** Create a linked worktree for `branch` under the fixture treeDir. */
function addWorktree(branch: string, base = "main"): string {
  const wtPath = resolve(treeDir, branchToPath(branch));
  git(["worktree", "add", "-q", "-b", branch, wtPath, base]);
  return wtPath;
}

/** Write an executable scratch script. */
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

/** stdout of the fake `jj` CLI for one argv. */
function jjReply(cmd: string[]): string {
  if (cmd[1] === "op" && cmd[2] === "log") return "op-test-1\n";
  return "";
}

/** stdout of the fake `pijul` CLI for one argv. */
function pijulReply(cmd: string[]): string {
  if (cmd[1] !== "log") return "";
  const channel = cmd[cmd.indexOf("--channel") + 1] ?? "";
  // The base channel holds one unrelated change; the feature channel holds two
  // changes that must be applied onto it.
  return channel === "main"
    ? JSON.stringify(["aaaa00000000000000000000000001"])
    : JSON.stringify([
      "bbbb00000000000000000000000001",
      "bbbb00000000000000000000000002",
    ]);
}

/** Stub the backend CLIs; every other command keeps the real spawn. */
function stubBackendSpawns(): void {
  Bun.spawnSync = ((cmd: string[], options?: unknown) => {
    const bin = cmd[0];
    if (bin !== "jj" && bin !== "pijul") {
      return (realSpawnSync as unknown as (c: string[], o?: unknown) => unknown)(cmd, options);
    }
    backendCalls.push(cmd.join(" "));
    const out = bin === "jj" ? jjReply(cmd) : pijulReply(cmd);
    return {
      exitCode: 0,
      stdout: Buffer.from(out),
      stderr: Buffer.from(""),
      success: true,
      signal: null,
    };
  }) as unknown as typeof Bun.spawnSync;
}

// --------------------------------------------------------------------------
// Driving finalize() in-process
// --------------------------------------------------------------------------

interface FinalizeRun {
  output: string;
  exitCode: number | null;
  error: Error | null;
  /** Exit listeners finalize installed during the call (e.g. the failure gripe). */
  installedExitHooks: (() => void)[];
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

  const savedExit = process.listeners("exit");
  let error: Error | null = null;
  let installedExitHooks: (() => void)[] = [];
  try {
    await finalize(args, cfg);
  } catch (err) {
    error = err as Error;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    installedExitHooks = process
      .listeners("exit")
      .filter((hook) => !savedExit.includes(hook)) as (() => void)[];
    process.removeAllListeners("exit");
    for (const listener of savedExit) process.on("exit", listener as () => void);
  }
  return {
    output: chunks.join(""),
    exitCode: exits.length > 0 ? exits[exits.length - 1]! : null,
    error,
    installedExitHooks,
  };
}

/** Check-command argv recorded so far. */
function checkArgs(): string[] {
  if (!existsSync(argsPath)) return [];
  return readFileSync(argsPath, "utf8").trim().split("\n").filter((line) => line !== "");
}

// --------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------

beforeEach(() => {
  setLogLevel("info");
  setOutputFormat("simple");
  // Own the slot root for the duration of this test, restore the previous
  // value afterwards so a sibling file's setting is never clobbered.
  savedSlotDir = process.env.GIWT_CHECK_SLOT_DIR;
  savedSlotWait = process.env.GIWT_CHECK_SLOT_WAIT_MS;
  process.env.GIWT_CHECK_SLOT_DIR = SLOT_DIR;
  process.env.GIWT_CHECK_SLOT_WAIT_MS = "0";
  root = mkdtempSync(join(scratchRoot(), "giwt-finalize-native-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt finalize native test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, ".gitignore"), ".worktree-finalize.lock\n.tmp/\n");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-qm", "seed"]);
  treesRoot = mkdtempSync(join(scratchRoot(), "giwt-finalize-native-trees-"));
  treeDir = resolve(treesRoot, "tree");
  mkdirSync(treeDir);
  toolsRoot = mkdtempSync(join(scratchRoot(), "giwt-finalize-native-tools-"));
  toolsDir = resolve(toolsRoot, "tools");
  mkdirSync(toolsDir);
  argsPath = join(toolsDir, "check-args.txt");
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir,
    settings: structuredClone(DEFAULT_SETTINGS),
  };
  config.settings.branches.root = "main";
  backendCalls = [];
  stubBackendSpawns();
});

afterEach(() => {
  Bun.spawnSync = realSpawnSync;
  rmSync(root, { recursive: true, force: true });
  rmSync(treesRoot, { recursive: true, force: true });
  rmSync(toolsRoot, { recursive: true, force: true });
  // Only this file's own slot root is deleted; the previous env value is
  // restored so a sibling test file keeps its own hermetic slot root.
  rmSync(SLOT_DIR, { recursive: true, force: true });
  if (savedSlotDir === undefined) delete process.env.GIWT_CHECK_SLOT_DIR;
  else process.env.GIWT_CHECK_SLOT_DIR = savedSlotDir;
  if (savedSlotWait === undefined) delete process.env.GIWT_CHECK_SLOT_WAIT_MS;
  else process.env.GIWT_CHECK_SLOT_WAIT_MS = savedSlotWait;
});

// --------------------------------------------------------------------------
// jj backend
// --------------------------------------------------------------------------

describe("finalize native jj backend", () => {
  test("runs the gates then moves the bookmark", async () => {
    config.settings.vcs.backend = "jj";
    const wtPath = addWorktree("feature/x");
    git(["commit", "-q", "--allow-empty", "-m", "feature"], wtPath);
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    const run = await driveFinalize(["feature/x"]);

    expect(run.error).toBeNull();
    expect(run.output).toContain("jj finalize complete for 'feature/x'");
    expect(backendCalls).toContain("jj op log -n 1 -T id");
    expect(backendCalls).toContain("jj bookmark set feature/x -r @");
    expect(checkArgs()).toEqual(["--diff-base", "main"]);
  });

  test("reverts the operation and surfaces the failure when a gate fails", async () => {
    config.settings.vcs.backend = "jj";
    const wtPath = addWorktree("feature/x");
    git(["commit", "-q", "--allow-empty", "-m", "feature"], wtPath);
    withBunLock(wtPath);
    configureCommands("echo 'gate failed'; exit 1");

    const run = await driveFinalize(["feature/x"]);

    expect(run.error?.message).toBe("checks failed");
    expect(backendCalls).toContain("jj op revert --op op-test-1");
    expect(backendCalls).not.toContain("jj bookmark set feature/x -r @");
  });

  test("skips the gates when the worktree has no bun.lock", async () => {
    config.settings.vcs.backend = "jj";
    addWorktree("feature/x");

    const run = await driveFinalize(["feature/x"]);

    expect(run.error).toBeNull();
    expect(run.output).toContain("Skipped gates: no bun.lock found");
    expect(run.output).toContain("jj finalize complete for 'feature/x'");
    expect(checkArgs()).toEqual([]);
  });

  test("reverts the operation when the unit tests fail", async () => {
    config.settings.vcs.backend = "jj";
    const wtPath = addWorktree("feature/x");
    withBunLock(wtPath);
    configureCommands("exit 0", "echo 'FAIL src/x.test.ts'; exit 1");

    const run = await driveFinalize(["feature/x"]);

    expect(run.error?.message).toBe("tests failed");
    expect(backendCalls).toContain("jj op revert --op op-test-1");
    expect(backendCalls).not.toContain("jj bookmark set feature/x -r @");
  });

  test("forwards --gates and --jobs to the check command", async () => {
    config.settings.vcs.backend = "jj";
    const wtPath = addWorktree("feature/x");
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    const run = await driveFinalize(["feature/x", "--gates", "lint", "--jobs", "2"]);

    expect(run.error).toBeNull();
    expect(checkArgs()).toEqual(["--diff-base", "main", "--gates", "lint", "--jobs", "2"]);
  });

  test("forwards --skip-gates to the check command", async () => {
    config.settings.vcs.backend = "jj";
    const wtPath = addWorktree("feature/x");
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    const run = await driveFinalize(["feature/x", "--skip-gates", "knip"]);

    expect(run.error).toBeNull();
    expect(checkArgs()).toEqual(["--diff-base", "main", "--skip-gates", "knip"]);
  });

  test("uses --onto as the gate diff base", async () => {
    config.settings.vcs.backend = "jj";
    const wtPath = addWorktree("feature/x");
    withBunLock(wtPath);
    configureCommands(`printf '%s\\n' "$@" > ${argsPath}`);

    const run = await driveFinalize(["feature/x", "--onto", "release"]);

    expect(run.error).toBeNull();
    expect(checkArgs()).toEqual(["--diff-base", "release"]);
  });

  test("captures the gate output into the active run record", async () => {
    config.settings.vcs.backend = "jj";
    const wtPath = addWorktree("feature/x");
    withBunLock(wtPath);
    configureCommands("echo 'check marker'; exit 0");
    const recorder = beginRun(config, "finalize", ["feature/x"], null, "feature/x");
    if (!recorder) throw new Error("run-record fixture could not be created");

    try {
      const run = await driveFinalize(["feature/x"]);

      expect(run.error).toBeNull();
      expect(readFileSync(join(recorder.dir, "check.log"), "utf8")).toContain("check marker");
    } finally {
      finishActiveRun(0);
    }
  });

  test("refuses when the branch has no worktree", async () => {
    config.settings.vcs.backend = "jj";

    const run = await driveFinalize(["missing/branch"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("no worktree found for branch 'missing/branch'");
    expect(backendCalls).toEqual([]);
  });

  test("records a failure gripe when the exit hook fires", async () => {
    // finalize installs the failure-gripe exit hook before the backend
    // dispatch, so a native refusal that exits 1 gripes the tree ledger.
    config.settings.vcs.backend = "jj";
    const savedCode = process.exitCode;
    let run: FinalizeRun;
    try {
      run = await driveFinalize(["missing/branch"]);
      expect(run.exitCode).toBe(1);
      process.exitCode = 1;
      for (const hook of run.installedExitHooks) hook();
    } finally {
      process.exitCode = typeof savedCode === "number" ? savedCode : 0;
    }
    expect(readFileSync(join(treeDir, ".ledger.jsonl"), "utf8")).toContain(
      "finalize missing/branch failed (exit 1)",
    );
  });

  test("dispatches before the git-only preconditions", async () => {
    // 'main' is a protected branch and the configured target branch is
    // missing: the git path refuses both. The native dispatch runs before
    // any of those git-only probes.
    config.settings.vcs.backend = "jj";
    config.settings.branches.root = "missing-root";

    const run = await driveFinalize(["main"]);

    expect(run.output).not.toContain("cannot finalize protected branch 'main'");
    expect(run.output).not.toContain("target branch 'missing-root' not found");
    expect(run.output).toContain("jj finalize complete for 'main'");
  });
});

// --------------------------------------------------------------------------
// pijul backend
// --------------------------------------------------------------------------

describe("finalize native pijul backend", () => {
  test("applies the recorded changes onto the base channel", async () => {
    config.settings.vcs.backend = "pijul";
    const wtPath = addWorktree("feature/x");
    withBunLock(wtPath);
    configureCommands("exit 0");

    const run = await driveFinalize(["feature/x"]);

    expect(run.error).toBeNull();
    expect(run.output).toContain("pijul finalize complete for 'feature/x'");
    expect(backendCalls).toContain(
      "pijul log --hash-only --output-format json --channel feature/x",
    );
    expect(backendCalls).toContain(
      "pijul apply bbbb00000000000000000000000002 --channel main",
    );
    expect(backendCalls).toContain(
      "pijul apply bbbb00000000000000000000000001 --channel main",
    );
  });

  test("performs no pijul mutation when a gate fails", async () => {
    config.settings.vcs.backend = "pijul";
    const wtPath = addWorktree("feature/x");
    withBunLock(wtPath);
    configureCommands("echo 'gate failed'; exit 1");

    const run = await driveFinalize(["feature/x"]);

    expect(run.error?.message).toBe("checks failed");
    expect(backendCalls.some((call) => call.includes("apply"))).toBe(false);
  });

  test("refuses when the branch has no worktree", async () => {
    config.settings.vcs.backend = "pijul";

    const run = await driveFinalize(["missing/branch"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("no worktree found for branch 'missing/branch'");
  });
});

// --------------------------------------------------------------------------
// git backend: the target-branch precondition the native path skips
// --------------------------------------------------------------------------

describe("finalize git target branch precondition", () => {
  test("refuses when the target branch does not exist", async () => {
    const wtPath = addWorktree("feature/x");
    git(["commit", "-q", "--allow-empty", "-m", "feature"], wtPath);
    config.settings.branches.root = "missing-root";

    const run = await driveFinalize(["feature/x"]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("target branch 'missing-root' not found");
    expect(run.output).toContain("Then: pass --onto <branch>, or set [branches] root in giwt.toml");
  });
});
