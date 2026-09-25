// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `ticket` and its `stripTypePrefix` helper.
 *
 * Pure-function suite at the top exercises `stripTypePrefix` in isolation
 * (covers BUG-giwt-ticket-extid-double-prefix-on-duplicate-type-slug).
 *
 * End-to-end suite below proves `ticket` invoked from inside a linked
 * worktree (TASK-GIWT-TICKET-CREATE-TICKETS-FROM-INSIDE-A-WORKTREE):
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

import { describe, expect, it, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSync } from "../tickets/sync-index";
import { loadConfig } from "../utils/config";
import { stripTypePrefix, ticket } from "./ticket";

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

describe("stripTypePrefix — literal type-prefix strip", () => {
  test("'FEAT' + 'FEAT story UI' → 'story UI' (case-insensitive)", () => {
    expect(stripTypePrefix("FEAT", "FEAT story UI")).toBe("story UI");
  });

  test("'feat' + 'feat story UI' → 'story UI' (lowercase type)", () => {
    expect(stripTypePrefix("feat", "feat story UI")).toBe("story UI");
  });

  test("'BUG' + 'BUG: story ui' → 'story ui' (colon form)", () => {
    expect(stripTypePrefix("BUG", "BUG: story ui")).toBe("story ui");
  });

  test("'FEAT' + 'feat:' → '' (whole-title collapse, colon)", () => {
    expect(stripTypePrefix("FEAT", "feat:")).toBe("");
  });
});

describe("stripTypePrefix — whole-title collapse", () => {
  test("'TASK' + 'TASK-' → ''", () => {
    expect(stripTypePrefix("TASK", "TASK-")).toBe("");
  });

  test("'BUG' + 'BUG' → ''", () => {
    expect(stripTypePrefix("BUG", "BUG")).toBe("");
  });
});

describe("stripTypePrefix — no-op when no leading prefix", () => {
  test("'BUG' + 'something else' → 'something else'", () => {
    expect(stripTypePrefix("BUG", "something else")).toBe("something else");
  });

  test("'BUG' + 'unrelated prose here' → 'unrelated prose here'", () => {
    expect(stripTypePrefix("BUG", "unrelated prose here")).toBe(
      "unrelated prose here",
    );
  });
});

describe("stripTypePrefix — broader duplicate-prefix (literal no-op)", () => {
  test(
    "'BUG' + 'giwt ticket extid double prefix on duplicate type slug' → "
      + "title unchanged (no literal BUG prefix)",
    () => {
      expect(
        stripTypePrefix(
          "BUG",
          "giwt ticket extid double prefix on duplicate type slug",
        ),
      ).toBe("giwt ticket extid double prefix on duplicate type slug");
    },
  );
});

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

/**
 * Issue-metadata path: with a real `git issue` CLI, `ticket` must apply the
 * flag set to the created issue (labels in one `edit -l` invocation,
 * priority in its own), record the plan-spec comment, and warn — without
 * rewriting — when the plan file already exists.
 */
describe.skipIf(Bun.which("git-issue") === null)("ticket issue metadata (real git issue)", () => {
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

  /** The issue hash for `extid`, or null when no matching issue exists. */
  function issueHash(repo: string, extid: string): string | null {
    const out = git(repo, "issue", "ls", "--all", "--format", "oneline");
    const line = out.split("\n").find((l) => l.includes(extid));
    return line?.split(" ")[0] ?? null;
  }

  it("applies flags to the .md and the git issue, and warns on a repeated title", async () => {
    const base = mkdtempSync(join(tmpdir(), "giwt-ticket-meta-"));
    const repo = join(base, "proj");
    const prevCwd = process.cwd();
    try {
      initRepoWithCommit(repo);
      mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
      process.chdir(repo);
      const config = await loadConfig();

      const cap1 = capture();
      try {
        await ticket([
          "TASK",
          "metadata probe",
          "first body",
          "-l",
          "bug,backend",
          "-p",
          "high",
          "-e",
          "EPIC-7",
          "--effort",
          "S",
          "--tag",
          "alpha,beta",
        ], config);
      } finally {
        cap1.restore();
      }
      expect(cap1.text()).toContain("created ticket file: .plan/tickets/TASK-metadata-probe.md");

      const md = readFileSync(join(repo, ".plan", "tickets", "TASK-metadata-probe.md"), "utf8");
      expect(md).toContain("# TASK: metadata probe");
      expect(md).toContain("**Priority:** high");
      expect(md).toContain("**Effort:** S");
      expect(md).toContain("**Epic:** EPIC-7");
      expect(md).toContain("**Tags:** alpha, beta");
      expect(md).toContain("first body");

      const hash = issueHash(repo, "TASK-metadata-probe");
      expect(hash).not.toBeNull();
      const show = git(repo, "issue", "show", hash!);
      expect(show).toContain("Labels:  bug, backend");
      expect(show).toContain("Priority: high");
      expect(show).toContain("Plan spec: .plan/tickets/TASK-metadata-probe.md");

      // Second run on the same title: plan file is preserved, issue count grows.
      const cap2 = capture();
      try {
        await ticket(["TASK", "metadata probe", "second body"], config);
      } finally {
        cap2.restore();
      }
      expect(cap2.text()).toContain(
        "ticket file already exists: .plan/tickets/TASK-metadata-probe.md",
      );
      const mdAfter = readFileSync(
        join(repo, ".plan", "tickets", "TASK-metadata-probe.md"),
        "utf8",
      );
      expect(mdAfter).toBe(md);
      expect(mdAfter).not.toContain("second body");
      const matches = git(repo, "issue", "ls", "--all", "--format", "oneline")
        .split("\n")
        .filter((l) => l.includes("TASK-metadata-probe"));
      expect(matches.length).toBe(2);
    } finally {
      process.chdir(prevCwd);
      rmSync(base, { recursive: true, force: true });
    }
  });
});
