// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * End-to-end test for `ticket` invoked from inside a linked worktree
 * (TASK-GIWT-TICKET-CREATE-TICKETS-FROM-INSIDE-A-WORKTREE).
 *
 * The contract under proof:
 *   1. the ticket .md lands in the *invoking worktree*'s .plan/tickets/
 *      (getWorktreeRoot()), never in the main checkout;
 *   2. the git issue is created in the *shared registry* (config.repoRoot
 *      = main repo's .git, visible from every worktree);
 *   3. `runSync --fix` run in the worktree adopts the new ticket into the
 *      worktree-local index.json while the main checkout's index stays
 *      byte-identical.
 *
 * Resource contract (parallel-safe): each run owns a mkdtemp'd fixture root
 * containing its own git repo, linked worktree, and git-issue store (issues
 * live inside the fixture's .git). No fixed paths, no shared globals; cwd is
 * restored and the fixture removed in `finally` even on failure. Requires the
 * real `git issue` CLI — skipped where it is not installed.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSync } from "../tickets/sync-index";
import { loadConfig } from "../utils/config";
import { ticket } from "./ticket";

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

/** Run git in cwd; return stdout. Throws on failure — never swallows. */
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function initRepoWithCommit(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.email", "test@example.com");
  git(path, "config", "user.name", "test");
  git(path, "config", "commit.gpgsign", "false");
  writeFileSync(join(path, "f.txt"), "x\n");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "init");
}

describe("ticket command inside a linked worktree", () => {
  it.skipIf(Bun.which("git-issue") === null)(
    "creates the .md in the worktree, the issue in the shared registry, and sync adopts it into the worktree-local index",
    async () => {
      const base = mkdtempSync(join(tmpdir(), "giwt-ticket-wt-"));
      const repo = join(base, "proj");
      const wt = join(repo, "tree", "wt");
      const prevCwd = process.cwd();
      try {
        initRepoWithCommit(repo);
        git(repo, "worktree", "add", "-q", "-b", "wt-branch", wt);

        // Main checkout pre-state: an existing index.json with one unrelated
        // entry. The worktree sync must leave this file byte-identical.
        // Written AFTER `worktree add` (untracked) so the worktree does not
        // check out a stale copy of it.
        mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
        const mainIndexPath = join(repo, ".plan", "tickets", "index.json");
        const mainIndexBefore = JSON.stringify(
          {
            "TASK-UNRELATED-MAIN-TICKET": {
              hash: "pending",
              extid: "TASK-UNRELATED-MAIN-TICKET",
              type: "TASK",
              title: "unrelated main ticket",
              label: "task",
              priority: "medium",
              epic: "",
              tags: [],
              source: ".plan/tickets/TASK-unrelated-main-ticket.md",
              status: "done",
            },
          },
          null,
          2,
        ) + "\n";
        writeFileSync(mainIndexPath, mainIndexBefore);

        process.chdir(wt);
        const config = await loadConfig();

        // ── 1. Ticket file lands in the invoking worktree, not the main checkout ──
        await ticket(["TASK", "worktree ticket creation works", "body text"], config);

        const wtTicketFile = join(wt, ".plan", "tickets", "TASK-worktree-ticket-creation-works.md");
        expect(existsSync(wtTicketFile)).toBe(true);
        expect(
          existsSync(join(repo, ".plan", "tickets", "TASK-worktree-ticket-creation-works.md")),
        ).toBe(false);

        // ── 2. Git issue registered in the shared registry (main repo .git) ──
        const issues = git(repo, "issue", "ls", "--all", "--format", "oneline");
        expect(issues).toContain("TASK-worktree-ticket-creation-works");
        expect(issues).toContain("worktree ticket creation works");

        // ── 3. Sync adopts the new ticket into the worktree-local index ──
        runSync(config.worktreeRoot, { fix: true, ticketsPath: ".plan/tickets" });

        const wtIndex: Record<string, { source?: string; }> = JSON.parse(
          readFileSync(join(wt, ".plan", "tickets", "index.json"), "utf8"),
        );
        expect(wtIndex["TASK-WORKTREE-TICKET-CREATION-WORKS"]).toBeDefined();
        expect(wtIndex["TASK-WORKTREE-TICKET-CREATION-WORKS"]?.source).toBe(
          ".plan/tickets/TASK-worktree-ticket-creation-works.md",
        );
        // The main checkout's index is untouched — byte-identical.
        expect(readFileSync(mainIndexPath, "utf8")).toBe(mainIndexBefore);
      } finally {
        process.chdir(prevCwd);
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
});
