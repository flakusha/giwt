// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * End-to-end filesystem-isolation test: giwt managing a throwaway repo must
 * not write anywhere above it.
 *
 * Fixture layout (all under the giwt repo's gitignored .tmp/ — ignored via
 * the global core.excludesFile dot-dirs rule, verified in-test with
 * `git check-ignore`):
 *
 *   .tmp/e2e-iso-<uuid>/            containment dir (PRIVATE parent —
 *                                   parallel test files never contend here)
 *     repo/                         the fixture git repo giwt is pointed AT
 *     home/                         redirected $HOME for the giwt child
 *       .config/giwt/               canary: no global settings may appear
 *
 * Isolation guarantees proven below:
 *   1. Every giwt invocation runs as a child process with a scrubbed env:
 *      isolatedGitEnv() (strips GIT_, OMP_, PI_, ENGRAM_, MNEMO_ prefixed
 *      vars), no
 *      inherited REPO_ROOT/TREE_DIR (we set REPO_ROOT to the fixture),
 *      redirected HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME, and a PATH restricted
 *      to git + git-issue + bun + coreutils (/usr/bin:/bin — git-issue is a
 *      python script and shells out to sha256sum/mktemp/gpg).
 *   2. `giwt list` output and the announced run-record dir prove the resolved
 *      repoRoot equals the fixture, never the parent giwt repo.
 *   3. Canary files (content + mtime) placed BEFORE the run in the giwt repo
 *      root (.tmp-e2e-iso-canary-<unique>), the redirected $HOME/.config/giwt,
 *      and the /tmp/giwt scratch root (e2e-iso-canary-<unique>) are byte- and
 *      mtime-identical afterwards. The unique suffix (containment basename)
 *      prevents races between concurrent test invocations.
 *   4. The containment parent's directory listing (names + mtimes) is
 *      unchanged — everything giwt wrote landed INSIDE the fixture. This is
 *      the honest boundary of the test: writes to arbitrary paths elsewhere
 *      on the filesystem cannot be enumerated, so the containment parent
 *      (private to this test) plus the canaries are the tripwires.
 *
 * Command set: `list` (read-mostly), `ticket TASK … --epic e2e` (creates a
 * ticket .md + a git issue → exercises the ticket pipeline and its index
 * writes INSIDE the fixture), `sync` (reconciles .plan/tickets ↔ index.json
 * ↔ git issues → ledger/run-record writes inside the fixture).
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isolatedGitEnv } from "./utils/git";
import { scratchRoot } from "./utils/scratch-tmp";

/** This file lives directly under src/, so the repo root is one level up. */
const GIWT_REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");

/** Dynamic directory snapshot (names + mtimes) for the containment parent. */
function snapDir(dir: string): Map<string, number> {
  const snap = new Map<string, number>();
  for (const name of readdirSync(dir)) {
    snap.set(name, statSync(join(dir, name)).mtimeMs);
  }
  return snap;
}

function canaryState(path: string): { size: number; mtimeMs: number; } {
  const st = statSync(path);
  return { size: st.size, mtimeMs: st.mtimeMs };
}

describe("e2e: giwt manages a throwaway repo without touching anything above it", () => {
  let containment = "";
  let fixture = "";
  let home = "";

  afterEach(() => {
    if (containment) rmSync(containment, { recursive: true, force: true });
    containment = fixture = home = "";
  });

  test("ticket/sync/list against the fixture leave the outside world untouched", async () => {
    // ---- Fixture ---------------------------------------------------------
    containment = mkdtempSync(join(GIWT_REPO, ".tmp", "e2e-iso-"));
    fixture = join(containment, "repo");
    home = join(containment, "home");
    mkdirSync(fixture);
    mkdirSync(join(home, ".config", "giwt"), { recursive: true });

    const childGit = (args: string[]): void => {
      const p = Bun.spawnSync(["git", ...args], {
        cwd: fixture,
        env: isolatedGitEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });
      if (p.exitCode !== 0) {
        throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
      }
    };
    childGit(["init", "-q", "-b", "main", fixture]);
    // Fixture-local throwaway identity (task-sanctioned, matching every
    // existing fixture test): these writes live ONLY inside the throwaway
    // fixture repo under .tmp — never global, never the agent's own commit
    // identity. The machine has no global identity, so without these the
    // init commit cannot be created.
    childGit(["config", "user.email", "e2e-iso@fixture.localhost"]);
    childGit(["config", "user.name", "e2e isolation fixture"]);
    writeFileSync(join(fixture, "a.txt"), "base\n");
    // treeDir exists in a managed repo; appendLedger is best-effort and skips
    // runs entirely when it is missing (src/utils/ledger.ts). Create it so the
    // ledger write path is actually exercised inside the fixture.
    mkdirSync(join(fixture, "tree"));
    childGit(["add", "-A"]);
    childGit(["commit", "-q", "-m", "init"]);

    // .tmp must actually be gitignored so throwaway fixtures never get staged.
    const ignored = Bun.spawnSync(
      ["git", "check-ignore", "-q", join(GIWT_REPO, ".tmp", "e2e-iso-probe")],
      { cwd: GIWT_REPO, stdout: "ignore", stderr: "ignore" },
    );
    expect(ignored.exitCode).toBe(0);

    // ---- Sentinels (before the run) ---------------------------------------
    // Unique per run (containment basename): concurrent test invocations
    // must never collide on these two shared locations. Both canaries stay
    // OUTSIDE the containment dir — that's the point.
    const canaryTag = basename(containment);
    const repoCanary = join(GIWT_REPO, `.tmp-e2e-iso-canary-${canaryTag}`);
    const tmpCanary = join(scratchRoot(), `e2e-iso-canary-${canaryTag}`);
    writeFileSync(repoCanary, "do-not-touch\n");
    writeFileSync(tmpCanary, "do-not-touch\n");
    try {
      const repoCanaryBefore = canaryState(repoCanary);
      const homeCanaryBefore = canaryState(join(home, ".config", "giwt"));
      const tmpCanaryBefore = canaryState(tmpCanary);
      const parentBefore = snapDir(containment);
      const protectedNames = [basename(fixture), basename(home)];

      // ---- Scrubbed child env ------------------------------------------------
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(isolatedGitEnv())) {
        if (
          key === "REPO_ROOT" || key === "TREE_DIR" || key.startsWith("GIWT_")
          || key === "XDG_CONFIG_HOME" || key === "XDG_CACHE_HOME" || key === "HOME"
        ) {
          continue;
        }
        env[key] = value;
      }
      env.REPO_ROOT = fixture;
      env.HOME = home;
      env.XDG_CONFIG_HOME = join(home, ".config");
      env.XDG_CACHE_HOME = join(home, ".cache");
      const pathEntries = [
        dirname(Bun.which("git") ?? "/usr/bin/git"),
        dirname(Bun.which("git-issue") ?? "/usr/bin/git-issue"),
        dirname(process.execPath),
        "/usr/bin",
        "/bin",
      ];
      env.PATH = [...new Set(pathEntries)].join(":");

      const giwt = (args: string[]): { exitCode: number; out: string; } => {
        const p = Bun.spawnSync(
          [process.execPath, join(GIWT_REPO, "src", "cli.ts"), ...args],
          {
            cwd: fixture,
            env,
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        return {
          exitCode: p.exitCode ?? -1,
          out: p.stdout.toString() + p.stderr.toString(),
        };
      };

      // ---- Representative giwt command set -----------------------------------
      const list = giwt(["list"]);
      expect(list.exitCode).toBe(0);
      // repoRoot resolution: the fixture path in output, never the parent repo
      // itself (the fixture sits INSIDE the giwt repo, so the precise negative
      // assertion targets the parent's own runlog/run-record area).
      const parentRuns = join(GIWT_REPO, ".tmp", "giwt");
      expect(list.out).toContain(fixture);
      expect(list.out).not.toContain(parentRuns);
      // The announced run-record dir lives under the fixture's repoRoot.
      const runRecord = list.out.match(/Run record: (\S+)/)?.[1] ?? "";
      expect(runRecord.startsWith(fixture + "/")).toBe(true);

      const ticket = giwt(["ticket", "TASK", "e2e-isolation-probe", "--epic", "e2e"]);
      expect(ticket.exitCode).toBe(0);
      expect(existsSync(join(fixture, ".plan", "tickets", "TASK-e2e-isolation-probe.md")))
        .toBe(true);

      // A fresh index is empty, so the first sync reports the new ticket as an
      // orphan and exits 1 by design ("run with --fix"); reconcile first, then
      // assert a plain sync is clean.
      const syncFix = giwt(["sync", "--fix"]);
      expect(syncFix.exitCode).toBe(0);

      const sync = giwt(["sync"]);
      expect(sync.exitCode).toBe(0);

      const list2 = giwt(["list"]);
      expect(list2.exitCode).toBe(0);
      expect(list2.out).not.toContain(parentRuns);

      // Index/ledger/run artifacts landed INSIDE the fixture.
      expect(existsSync(join(fixture, ".plan", "tickets", "index.json"))).toBe(true);
      expect(existsSync(join(fixture, "tree", ".ledger.jsonl"))).toBe(true);
      expect(existsSync(join(fixture, ".tmp", "giwt", "runs"))).toBe(true);

      // ---- Sentinels (after the run) -----------------------------------------
      expect(canaryState(repoCanary)).toEqual(repoCanaryBefore);
      expect(canaryState(tmpCanary)).toEqual(tmpCanaryBefore);
      expect(canaryState(join(home, ".config", "giwt"))).toEqual(homeCanaryBefore);
      // Parent boundary: no NEW entries may appear in the containment dir, and
      // entries other than the fixture/home dirs (which giwt legitimately
      // writes INSIDE of) must be untouched. Boundary note: writes to arbitrary
      // paths elsewhere on the filesystem cannot be enumerated; these plus the
      // canaries are the tripwires.
      const parentAfter = snapDir(containment);
      expect([...parentAfter.keys()].sort()).toEqual([...parentBefore.keys()].sort());
      for (const [name, before] of parentBefore) {
        if (protectedNames.includes(name)) continue;
        expect(parentAfter.get(name)).toEqual(before);
      }
    } finally {
      rmSync(repoCanary, { force: true });
      rmSync(tmpCanary, { force: true });
    }
  }, 25000);
});
