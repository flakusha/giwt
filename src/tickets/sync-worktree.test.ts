// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * runSync worktree isolation
 * (ticket TASK-GIWT-SYNC-RECALCULATE-TICKETS-INDEX-INSIDE-A-WORKTREE).
 *
 * The command wiring resolves the *worktree* root and hands it to runSync
 * (sync.ts, plan.ts, finalize.ts, doctor.ts); these fixture repos prove the
 * contract end to end: a fix-mode sync inside a linked worktree applies
 * fixes in memory but writes NO worktree-local index.json — the target
 * branch stays canonical and the index is regenerated there post-merge.
 * The main checkout's index stays byte-identical, and sibling worktrees
 * never cross-adopt each other's tickets.
 *
 * Resource contract (parallel-safe): each test owns a private fixture built
 * with mkdtempSync() under the giwt scratch root (/tmp/giwt/) — a real git
 * repo plus linked
 * worktrees from `git worktree add` — and removes it in `finally`, so a
 * failing test cannot leak into others. No test chdir's (runSync takes root
 * parameters), no fixed paths, no shared mutable state, no ordering
 * dependence; bun:test may run this file concurrently with any other file.
 *
 * Assertions are file-side only. runSync shells out to `git issue ls`; on a
 * fixture repo that either yields no issues (CLI present) or reports the CLI
 * unavailable (absent), in which case --fix refuses without writing. Each
 * fix-mode test probes availability with the identical command first and
 * asserts the matching contract, so both outcomes stay deterministic — no
 * assertion depends on git-issue data existing.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { runSync } from "./sync-index";
import type { SyncSummary } from "./sync-options";

// ── Fixture helpers ────────────────────────────────────────────

/** Hermetic env for fixture git calls: concurrent test files may mutate
 * process.env (e.g. GNUPGHOME); spawned git must not inherit that. */
function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_") || key === "GNUPGHOME") continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
}

/** Main checkout with one commit plus `count` linked worktrees (sibling dirs). */
function initRepoWithWorktrees(dir: string, count: number): { main: string; wts: string[]; } {
  const main = join(dir, "main");
  mkdirSync(main, { recursive: true });
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "test@example.com");
  git(main, "config", "user.name", "test");
  git(main, "config", "commit.gpgsign", "false");
  writeFileSync(join(main, "f.txt"), "x\n");
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "init");

  const wts: string[] = [];
  for (let i = 1; i <= count; i++) {
    const wt = join(dir, `wt-${i}`);
    git(main, "worktree", "add", "-q", "-b", `wt-branch-${i}`, wt);
    wts.push(wt);
  }
  return { main, wts };
}

/** Minimal ticket .md shaped the way parseTicketFile expects. */
function writeTicket(root: string, filename: string, title: string): void {
  const dir = join(root, ".plan/tickets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, filename),
    `# TASK: ${title}\n`
      + "\n"
      + "**Status:** ⬜ Not Started\n"
      + "**Priority:** medium\n"
      + "\n"
      + "Minimal body.\n",
  );
}

/** The exact probe runSync's readGitIssues performs — same command, cwd, env. */
function gitIssueLsAvailable(root: string): boolean {
  try {
    execSync("git issue ls --all --format oneline 2>/dev/null", {
      encoding: "utf8",
      timeout: 10_000,
      cwd: root,
      env: isolatedGitEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

function readIndexBytes(root: string): Buffer {
  return readFileSync(join(root, ".plan/tickets", "index.json"));
}

/** Leftover atomic-write temporaries or a stuck fix-mode lock. */
function syncResidue(root: string): string[] {
  return readdirSync(join(root, ".plan/tickets")).filter(
    (f) => f === ".index-sync.lock" || f.startsWith("index.json.tmp-"),
  );
}

/** Silence runSync's raw()/log() chatter (convention: report.test.ts). */
function quiet(): { restore: () => void; } {
  const out = spyOn(process.stdout, "write");
  out.mockImplementation(() => true);
  const err = spyOn(process.stderr, "write");
  err.mockImplementation(() => true);
  return {
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("runSync worktree isolation", () => {
  test("--fix recalculation is isolated to the invoking worktree", () => {
    const dir = mkdtempSync(join(scratchRoot(), "sync-worktree-"));
    const silencer = quiet();
    try {
      const { main, wts } = initRepoWithWorktrees(dir, 1);
      const wt = wts[0]!;

      // Main-only state, written AFTER the worktree was created so the
      // worktree checkout never contains it.
      writeTicket(main, "TASK-main-only-ticket.md", "main only ticket");
      writeFileSync(join(main, ".plan/tickets", "index.json"), "{}\n");
      const mainIndexBefore = readIndexBytes(main);

      // Worktree-only orphan ticket; no index there yet.
      writeTicket(wt, "TASK-wt-only-ticket.md", "wt only ticket");

      const exit = runSync(wt, { fix: true, ticketsPath: ".plan/tickets" });

      if (gitIssueLsAvailable(wt)) {
        // Worktree fix run applies fixes in memory but writes NO index.json:
        // the target branch stays canonical and the index is regenerated
        // there post-merge.
        expect(exit).toBe(0);
        expect(existsSync(join(wt, ".plan/tickets", "index.json"))).toBe(false);
      } else {
        // Documented refusal: registry unreadable → --fix must not guess.
        expect(exit).toBe(1);
        expect(existsSync(join(wt, ".plan/tickets", "index.json"))).toBe(false);
      }

      // Isolation: main's index stays byte-identical and mentions nothing
      // from the worktree; the worktree's tickets dir has no lock/tmp residue.
      expect(readIndexBytes(main).equals(mainIndexBefore)).toBe(true);
      expect(readIndexBytes(main).toString("utf8")).not.toContain("TASK-WT-ONLY-TICKET");
      expect(syncResidue(wt)).toEqual([]);
    } finally {
      silencer.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dry-run from the main checkout sees only main state and writes nothing", () => {
    const dir = mkdtempSync(join(scratchRoot(), "sync-worktree-"));
    const silencer = quiet();
    try {
      const { main, wts } = initRepoWithWorktrees(dir, 1);
      const wt = wts[0]!;

      writeTicket(main, "TASK-main-only-ticket.md", "main only ticket");
      writeFileSync(join(main, ".plan/tickets", "index.json"), "{}\n");
      const mainIndexBefore = readIndexBytes(main);

      // A worktree-only orphan that a wrong-root run would have picked up.
      writeTicket(wt, "TASK-wt-only-ticket.md", "wt only ticket");

      const exit = runSync(main, { fix: false, ticketsPath: ".plan/tickets" });

      // Main's own orphan (.md present, empty index) is actionable → 1.
      // Deterministic regardless of `git issue` CLI presence: the dry-run
      // path never enters the availability-gated fix branch.
      expect(exit).toBe(1);

      // Dry-run writes nothing anywhere.
      expect(readIndexBytes(main).equals(mainIndexBefore)).toBe(true);
      expect(readIndexBytes(main).toString("utf8")).not.toContain("TASK-WT-ONLY-TICKET");
      expect(existsSync(join(wt, ".plan/tickets", "index.json"))).toBe(false);
      expect(syncResidue(main)).toEqual([]);
      expect(syncResidue(wt)).toEqual([]);
    } finally {
      silencer.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("divergent sibling worktrees do not cross-adopt", () => {
    const dir = mkdtempSync(join(scratchRoot(), "sync-worktree-"));
    const silencer = quiet();
    try {
      const { main, wts } = initRepoWithWorktrees(dir, 2);
      const [wt1, wt2] = wts as [string, string];
      writeTicket(wt1, "TASK-wt1-only-ticket.md", "wt1 only ticket");
      writeTicket(wt2, "TASK-wt2-only-ticket.md", "wt2 only ticket");

      const exit = runSync(wt2, { fix: true, ticketsPath: ".plan/tickets" });

      if (gitIssueLsAvailable(wt2)) {
        expect(exit).toBe(0);
      } else {
        expect(exit).toBe(1);
      }

      // No index.json anywhere: the invoking worktree, its sibling, or the
      // main checkout — worktree fix runs never write one.
      expect(existsSync(join(wt2, ".plan/tickets", "index.json"))).toBe(false);
      expect(existsSync(join(wt1, ".plan/tickets", "index.json"))).toBe(false);
      expect(existsSync(join(main, ".plan/tickets", "index.json"))).toBe(false);
      expect(syncResidue(wt2)).toEqual([]);
    } finally {
      silencer.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runSync linked-worktree deferred index classes", () => {
  test("worktree ticket → --fix deferred → check exit 0 pre-merge → post-merge regenerates", () => {
    const dir = mkdtempSync(join(scratchRoot(), "sync-deferred-"));
    const silencer = quiet();
    try {
      const { main, wts } = initRepoWithWorktrees(dir, 1);
      const wt = wts[0]!;
      const wtIndexPath = join(wt, ".plan/tickets", "index.json");

      // Worktree-only ticket (BUG-linked-worktree-sync-defers-…): the
      // canonical index write is deferred, so the orphan must never gate.
      writeTicket(wt, "TASK-wt-deferred-ticket.md", "wt deferred ticket");
      // The harness-wide global gitignore (`.*/`) hides .plan/ from fixture
      // adds — neutralize it for the staging call.
      git(wt, "-c", "core.excludesFile=", "add", "-A");
      git(wt, "commit", "-q", "-m", "ticket");

      const fixSummaries: SyncSummary[] = [];
      const fixExit = runSync(wt, {
        fix: true,
        ticketsPath: ".plan/tickets",
        onSummary: (s) => fixSummaries.push(s),
      });
      if (!gitIssueLsAvailable(wt)) {
        // Documented refusal: registry unreadable → --fix must not guess.
        expect(fixExit).toBe(1);
        return;
      }
      // Deferred verdict: exit 0, but NEVER "resolved" — the fix was not
      // persisted and the summary says so.
      expect(fixExit).toBe(0);
      expect(fixSummaries[0]!.issuesRemaining).toBe(0);
      expect(fixSummaries[0]!.deferredRemaining).toBe(1);
      expect(existsSync(wtIndexPath)).toBe(false);

      // Check mode pre-merge: same orphans, now deferred → exit 0.
      const checkSummaries: SyncSummary[] = [];
      const checkExit = runSync(wt, {
        ticketsPath: ".plan/tickets",
        onSummary: (s) => checkSummaries.push(s),
      });
      expect(checkExit).toBe(0);
      expect(checkSummaries[0]!.issuesRemaining).toBe(0);
      expect(checkSummaries[0]!.deferredRemaining).toBe(1);
      expect(existsSync(wtIndexPath)).toBe(false);

      // Post-merge: the ticket lands on the target branch; the main checkout
      // regenerates the canonical index and reconciles for real.
      git(main, "merge", "-q", "--no-edit", "wt-branch-1");
      const mainSummaries: SyncSummary[] = [];
      const mainExit = runSync(main, {
        fix: true,
        ticketsPath: ".plan/tickets",
        onSummary: (s) => mainSummaries.push(s),
      });
      expect(mainExit).toBe(0);
      expect(mainSummaries[0]!.deferredRemaining).toBeUndefined();
      const canonical = JSON.parse(
        readFileSync(join(main, ".plan/tickets", "index.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(Object.keys(canonical)).toContain("TASK-WT-DEFERRED-TICKET");
    } finally {
      silencer.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("linked-worktree check mode exits 0 with deferred orphans even without --fix", () => {
    const dir = mkdtempSync(join(scratchRoot(), "sync-deferred-check-"));
    const silencer = quiet();
    try {
      const { wts } = initRepoWithWorktrees(dir, 1);
      const wt = wts[0]!;
      writeTicket(wt, "TASK-wt-check-deferred.md", "wt check deferred");

      const summaries: SyncSummary[] = [];
      const exit = runSync(wt, {
        ticketsPath: ".plan/tickets",
        onSummary: (s) => summaries.push(s),
      });
      expect(exit).toBe(0);
      expect(summaries[0]!.deferredRemaining).toBe(1);
      expect(summaries[0]!.issuesRemaining).toBe(0);
      expect(existsSync(join(wt, ".plan/tickets", "index.json"))).toBe(false);
      expect(syncResidue(wt)).toEqual([]);
    } finally {
      silencer.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
