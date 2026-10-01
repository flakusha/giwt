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
import { resolveStatus } from "../plan/status-vocab";
import { TICKET_REQUIRED_SECTIONS } from "../plan/validate";
import { runSync } from "../tickets/sync-index";
import { loadConfig } from "../utils/config";
import {
  closeTicketFile,
  closeTickets,
  copyTickets,
  hunkCount,
  renderTicketFile,
  stripTypePrefix,
  threeWay,
  ticket,
  type TicketFlags,
} from "./ticket";

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

describe("renderTicketFile — generated template is gate-clean", () => {
  const FLAGS: TicketFlags = {
    labels: [],
    priority: "high",
    epic: "some-epic",
    tags: ["a", "b"],
    effort: "Small",
  };

  it("emits a Status the status-vocab gate accepts as already canonical", () => {
    const m = renderTicketFile("BUG", "some title", FLAGS, "body").match(
      /\*\*Status:\*\* (.+)/,
    );
    expect(m).not.toBeNull();
    expect(resolveStatus(m![1] ?? "", {})).toEqual({
      value: "Not Started",
      action: "valid",
    });
  });

  it("carries every metadata marker the format gate requires", () => {
    const content = renderTicketFile("FEAT", "some title", FLAGS, "");
    for (const section of TICKET_REQUIRED_SECTIONS) {
      expect(content).toMatch(new RegExp(`\\*\\*${section}:\\*\\*`, "i"));
    }
  });

  it("does not regress to the rejected H2-heading or emoji-decorated shapes", () => {
    const content = renderTicketFile("TASK", "some title", FLAGS, "body");
    expect(content).not.toMatch(/^## (Summary|Context|Acceptance Criteria)$/m);
    expect(content).not.toContain("⬜");
  });
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

// ── ticket close / copy / 3way suites ──────────────────────────

/** Capture stdout+stderr for machine-format assertions. */
function captureOut(): { text: () => string; restore: () => void; } {
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

/** Ticket .md body shaped like `renderTicketFile` output. */
function ticketMd(title: string, status: string, body: string): string {
  return [
    `# TASK: ${title}`,
    "",
    `**Status:** ${status}`,
    "**Priority:** medium",
    "",
    "**Summary:**",
    "",
    body,
    "",
    "**Acceptance Criteria:**",
    "",
    "- [ ] first box",
    "- [ ] second box",
    "",
  ].join("\n");
}

interface FixtureEntry {
  hash: string;
  extid: string;
  source: string;
}

/** Write a minimal index.json into `root`'s tickets dir. */
function writeIndexAt(root: string, entries: Record<string, FixtureEntry>): void {
  mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
  const out: Record<string, unknown> = {};
  for (const [key, e] of Object.entries(entries)) {
    out[key] = {
      hash: e.hash,
      extid: e.extid,
      type: "TASK",
      title: key.toLowerCase(),
      label: "task",
      priority: "medium",
      epic: "",
      tags: [],
      source: e.source,
      status: "open",
    };
  }
  writeFileSync(join(root, ".plan", "tickets", "index.json"), `${JSON.stringify(out, null, 2)}\n`);
}

/** Scratch repo with `.plan/tickets/` ready. */
function makeTicketRepo(tag: string): { base: string; repo: string; cleanup: () => void; } {
  const base = mkdtempSync(join(tmpdir(), tag));
  const repo = join(base, "proj");
  initRepoWithCommit(repo);
  mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
  return { base, repo, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** Create a real git issue for `extid`; return its hash. */
function createIssueFor(repo: string, extid: string): string {
  git(repo, "issue", "create", `${extid}: probe ticket`, "-m", "probe body");
  const line = git(repo, "issue", "ls", "--all", "--format", "oneline")
    .split("\n")
    .find((l) => l.includes(extid));
  if (!line) throw new Error(`fixture: no issue created for ${extid}`);
  return line.split(" ")[0]!;
}

/** Repo with a REAL merge conflict on a ticket .md. `modify`: both
 *  branches edit a tracked file (3 stages). `add-add`: both branches add
 *  the same new path (stages 2+3 only — BASE absent). */
function makeConflictRepo(
  tag: string,
  mode: "modify" | "add-add" = "modify",
): { root: string; rel: string; cleanup: () => void; } {
  const base = mkdtempSync(join(tmpdir(), tag));
  const root = join(base, "proj");
  initRepoWithCommit(root);
  const rel = ".plan/tickets/TASK-conflict-probe.md";
  const abs = join(root, rel);
  mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
  if (mode === "modify") {
    writeFileSync(abs, "**Status:** In Progress\n\nbase body\n");
    // -f: .plan is commonly excluded (repo fixture convention, see
    // plan/reconcile-conflicts.test.ts) and the conflict needs the file tracked.
    git(root, "add", "-A", "-f");
    git(root, "commit", "-qm", "ticket base");
    git(root, "checkout", "-qb", "side-a");
    writeFileSync(abs, "**Status:** In Progress\n\nside a body\n");
    git(root, "commit", "-qam", "side a");
    git(root, "checkout", "-q", "main");
    writeFileSync(abs, "**Status:** In Progress\n\nmain body\n");
    git(root, "commit", "-qam", "main edit");
  } else {
    git(root, "checkout", "-qb", "side-a");
    writeFileSync(abs, "**Status:** In Progress\n\nside a body\n");
    git(root, "add", "-A", "-f");
    git(root, "commit", "-qm", "side a adds ticket");
    git(root, "checkout", "-q", "main");
    // main's tree lacks .plan, so checkout removed the (now-tracked-only) dir.
    mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
    writeFileSync(abs, "**Status:** In Progress\n\nmain body\n");
    git(root, "add", "-A", "-f");
    git(root, "commit", "-qm", "main adds ticket");
  }
  try {
    git(root, "merge", "--no-edit", "side-a");
  } catch {
    // expected: git() throws on the non-zero conflict merge exit
  }
  if (!git(root, "ls-files", "-u", "--", rel).includes(rel)) {
    throw new Error("fixture failed to produce a merge conflict");
  }
  return { root, rel, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

describe("ticket closeTicketFile — pure .md rewrite", () => {
  it("canonicalizes header status, ticks boxes, appends Resolved with note", () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-close-pure-"));
    try {
      const f = join(dir, "t.md");
      const lines = [
        "# TASK: header probe",
        "",
        "**Status:** In Progress",
        "**Priority:** medium",
        "",
      ];
      while (lines.length < 34) lines.push("filler");
      lines.push("**Status:** body mention");
      lines.push("- [ ] late box");
      writeFileSync(f, `${lines.join("\n")}\n`);

      closeTicketFile(f, "shipped in v2");
      const after = readFileSync(f, "utf8");
      expect(after).toContain("**Status:** Done");
      // Body status mention past the header region stays untouched.
      expect(after).toContain("**Status:** body mention");
      expect(after).toContain("- [x] late box");
      expect(after).toMatch(/\*\*Resolved:\*\* \d{4}-\d{2}-\d{2}T[\d:.]+Z shipped in v2\n$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves the line's own colon spelling while canonicalizing the value", () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-close-pure2-"));
    try {
      const f = join(dir, "t.md");
      writeFileSync(f, "**Status**: In Progress\n- [ ] box\n");
      closeTicketFile(f, "");
      const after = readFileSync(f, "utf8");
      expect(after).toContain("**Status**: Done");
      // No --note: Resolved line carries the date only.
      expect(after).toMatch(/\*\*Resolved:\*\* \d{4}-\d{2}-\d{2}T[\d:.]+Z\n$/);
      expect(after).toContain("- [x] box");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ticket close — index/registry refusals", () => {
  it("throws naming the id when the index has no entry", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-close-miss-");
    const prevCwd = process.cwd();
    try {
      writeIndexAt(repo, {});
      process.chdir(repo);
      const config = await loadConfig();
      await expect(closeTickets(["TASK-NOPE"], config)).rejects.toThrow(
        /TASK-NOPE: no ticket index entry/,
      );
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });
});

describe("ticket close/copy/3way — arg and error-path coverage", () => {
  function withExit(): { exits: number[]; restore: () => void; } {
    const exits: number[] = [];
    const orig = process.exit;
    process.exit = ((code?: number): never => {
      exits.push(code ?? 0);
      throw new Error(`__exit:${code ?? 0}`);
    }) as never;
    return {
      exits,
      restore: (): void => {
        process.exit = orig;
      },
    };
  }

  it("close with no ids exits 1 with usage", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-close-noid-");
    const prevCwd = process.cwd();
    const guard = withExit();
    try {
      writeIndexAt(repo, {});
      process.chdir(repo);
      const config = await loadConfig();
      await expect(closeTickets([], config)).rejects.toThrow("__exit:1");
      expect(guard.exits).toEqual([1]);
    } finally {
      guard.restore();
      process.chdir(prevCwd);
      cleanup();
    }
  });

  it("close accepts --note= form", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-close-notef-");
    const prevCwd = process.cwd();
    try {
      const mdRel = ".plan/tickets/TASK-note-form.md";
      writeFileSync(join(repo, mdRel), ticketMd("note form", "In Progress", "- [ ] a"));
      writeIndexAt(repo, {
        "TASK-NOTE-FORM": { hash: "pending", extid: "TASK-NOTE-FORM", source: mdRel },
      });
      process.chdir(repo);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await closeTickets(["TASK-NOTE-FORM", "--note=via equals"], config);
      } finally {
        cap.restore();
      }
      const md = readFileSync(join(repo, mdRel), "utf8");
      expect(md).toContain("**Status:** Done");
      expect(md).toContain("**Resolved:**");
      expect(md).toContain("via equals");
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  it("copy with no ids or both directions exits 1 with usage", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-copy-usage-");
    const prevCwd = process.cwd();
    const guard = withExit();
    try {
      process.chdir(repo);
      const config = await loadConfig();
      await expect(copyTickets([], config)).rejects.toThrow("__exit:1");
      await expect(copyTickets(["X", "--to", repo, "--from", repo], config)).rejects.toThrow(
        "__exit:1",
      );
      expect(guard.exits).toEqual([1, 1]);
    } finally {
      guard.restore();
      process.chdir(prevCwd);
      cleanup();
    }
  });

  it("copy --to= form copies bytes; unknown id and non-checkout throw naming them", async () => {
    const base = mkdtempSync(join(tmpdir(), "giwt-copy-form-"));
    const repo = join(base, "proj");
    initRepoWithCommit(repo);
    const other = join(base, "other");
    initRepoWithCommit(other);
    const prevCwd = process.cwd();
    try {
      const mdRel = ".plan/tickets/TASK-copy-eq.md";
      mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
      writeFileSync(join(repo, mdRel), ticketMd("copy eq", "Not Started", "b"));
      writeIndexAt(repo, {
        "TASK-COPY-EQ": { hash: "pending", extid: "TASK-COPY-EQ", source: mdRel },
      });
      process.chdir(repo);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await copyTickets(["TASK-COPY-EQ", `--to=${other}`], config);
      } finally {
        cap.restore();
      }
      expect(readFileSync(join(other, mdRel), "utf8")).toBe(
        readFileSync(join(repo, mdRel), "utf8"),
      );

      // --to at a directory without .git → throw naming the path.
      const notRepo = join(base, "plain");
      mkdirSync(notRepo, { recursive: true });
      await expect(copyTickets(["TASK-COPY-EQ", "--to", notRepo], config)).rejects.toThrow(
        /not a git checkout/,
      );

      // Unknown id → throw naming the id.
      await expect(copyTickets(["TASK-NOPE", "--to", other], config)).rejects.toThrow(
        /TASK-NOPE: no ticket index entry/,
      );

      // Index entry whose source file is missing → throw naming the source.
      writeIndexAt(repo, {
        "TASK-COPY-EQ": { hash: "pending", extid: "TASK-COPY-EQ", source: mdRel },
        "TASK-GONE": { hash: "pending", extid: "TASK-GONE", source: ".plan/tickets/gone.md" },
      });
      await expect(copyTickets(["TASK-GONE", "--to", other], config)).rejects.toThrow(
        /ticket file missing/,
      );
    } finally {
      process.chdir(prevCwd);
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("3way without an argument exits 1; outside-checkout path throws", async () => {
    const fixture = makeConflictRepo("giwt-3way-args-");
    const prevCwd = process.cwd();
    const guard = withExit();
    try {
      process.chdir(fixture.root);
      const config = await loadConfig();
      await expect(threeWay([], config)).rejects.toThrow("__exit:1");
      expect(guard.exits).toEqual([1]);
      await expect(threeWay(["../outside.md"], config)).rejects.toThrow(/outside checkout/);
    } finally {
      guard.restore();
      process.chdir(prevCwd);
      fixture.cleanup();
    }
  });

  it("3way --emoji prints glyph lines with (absent) base on add/add", async () => {
    const fixture = makeConflictRepo("giwt-3way-emoji-", "add-add");
    const prevCwd = process.cwd();
    try {
      process.chdir(fixture.root);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await threeWay([fixture.rel, "--emoji"], config);
      } finally {
        cap.restore();
      }
      const out = cap.text();
      expect(out).toContain("📄 BASE (absent)");
      expect(out).toContain("📄 OURS");
      expect(out).toContain("📄 THEIRS");
      expect(out).toContain("🟡 ours-vs-theirs");
    } finally {
      process.chdir(prevCwd);
      fixture.cleanup();
    }
  });
});

describe.skipIf(Bun.which("git-issue") === null)("ticket close — registry round trip", () => {
  it("updates md status/ticks/note and closes the issue", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-close-one-");
    const prevCwd = process.cwd();
    try {
      const hash = createIssueFor(repo, "TASK-CLOSE-PROBE");
      const mdRel = ".plan/tickets/TASK-close-probe.md";
      writeFileSync(join(repo, mdRel), ticketMd("close probe", "In Progress", "probe body"));
      writeIndexAt(repo, {
        "TASK-CLOSE-PROBE": { hash, extid: "TASK-CLOSE-PROBE", source: mdRel },
      });

      process.chdir(repo);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        // lowercase operand: extid lookup is case-insensitive
        await closeTickets(["task-close-probe", "--note", "shipped it"], config);
      } finally {
        cap.restore();
      }

      const md = readFileSync(join(repo, mdRel), "utf8");
      expect(md).toContain("**Status:** Done");
      expect(md).toContain("- [x] first box");
      expect(md).toContain("- [x] second box");
      expect(md).toMatch(/\*\*Resolved:\*\* \d{4}-\d{2}-\d{2}T[\d:.]+Z shipped it\n$/);

      expect(git(repo, "issue", "show", hash)).toContain("[closed]");
      expect(cap.text()).toContain("TASK-CLOSE-PROBE");
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  it("closes many ids in one run (multi-id)", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-close-multi-");
    const prevCwd = process.cwd();
    try {
      const h1 = createIssueFor(repo, "TASK-MULTI-ONE");
      const h2 = createIssueFor(repo, "TASK-MULTI-TWO");
      const rel1 = ".plan/tickets/TASK-multi-one.md";
      const rel2 = ".plan/tickets/TASK-multi-two.md";
      writeFileSync(join(repo, rel1), ticketMd("multi one", "Not Started", "b1"));
      writeFileSync(join(repo, rel2), ticketMd("multi two", "In Progress", "b2"));
      writeIndexAt(repo, {
        "TASK-MULTI-ONE": { hash: h1, extid: "TASK-MULTI-ONE", source: rel1 },
        "TASK-MULTI-TWO": { hash: h2, extid: "TASK-MULTI-TWO", source: rel2 },
      });

      process.chdir(repo);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await closeTickets(["TASK-MULTI-ONE", "TASK-MULTI-TWO", "--note", "batch done"], config);
      } finally {
        cap.restore();
      }

      for (const rel of [rel1, rel2]) {
        const md = readFileSync(join(repo, rel), "utf8");
        expect(md).toContain("**Status:** Done");
        expect(md).toContain("**Resolved:**");
      }
      expect(git(repo, "issue", "show", h1)).toContain("[closed]");
      expect(git(repo, "issue", "show", h2)).toContain("[closed]");
      expect(cap.text()).toContain("TASK-MULTI-ONE");
      expect(cap.text()).toContain("TASK-MULTI-TWO");
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  it("closes the .md only (with warning) when the entry hash is a pending placeholder", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-close-pend-");
    const prevCwd = process.cwd();
    try {
      const rel = ".plan/tickets/TASK-orphan-close.md";
      writeFileSync(join(repo, rel), ticketMd("orphan close", "Not Started", "b"));
      writeIndexAt(repo, {
        "TASK-ORPHAN-CLOSE": { hash: "pending", extid: "TASK-ORPHAN-CLOSE", source: rel },
      });

      process.chdir(repo);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await closeTickets(["TASK-ORPHAN-CLOSE"], config);
      } finally {
        cap.restore();
      }

      expect(readFileSync(join(repo, rel), "utf8")).toContain("**Status:** Done");
      expect(cap.text()).toContain("closed the .md only");
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  it("machine formats round-trip: --json parses, --toml parses, --emoji renders", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-close-fmt-");
    const prevCwd = process.cwd();
    try {
      const entries: Record<string, FixtureEntry> = {};
      for (
        const [extid, file] of [
          ["TASK-JSON-PROBE", ".plan/tickets/TASK-json-probe.md"],
          ["TASK-TOML-PROBE", ".plan/tickets/TASK-toml-probe.md"],
          ["TASK-EMOJI-PROBE", ".plan/tickets/TASK-emoji-probe.md"],
        ] as const
      ) {
        const hash = createIssueFor(repo, extid);
        writeFileSync(join(repo, file), ticketMd(extid.toLowerCase(), "Not Started", "b"));
        entries[extid] = { hash, extid, source: file };
      }
      writeIndexAt(repo, entries);

      process.chdir(repo);
      const config = await loadConfig();

      const capJson = captureOut();
      try {
        await closeTickets(["TASK-JSON-PROBE", "--json"], config);
      } finally {
        capJson.restore();
      }
      const parsed = JSON.parse(capJson.text()) as Array<Record<string, unknown>>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!["extid"]).toBe("TASK-JSON-PROBE");
      expect(parsed[0]!["file"]).toBe(".plan/tickets/TASK-json-probe.md");
      expect(parsed[0]!["status"]).toBe("Done");
      expect(String(parsed[0]!["issue"])).toMatch(/^[0-9a-f]{7,}$/);

      const capToml = captureOut();
      try {
        await closeTickets(["TASK-TOML-PROBE", "--toml"], config);
      } finally {
        capToml.restore();
      }
      const toml = Bun.TOML.parse(capToml.text()) as { items: Array<Record<string, string>>; };
      expect(toml.items).toHaveLength(1);
      expect(toml.items[0]!.extid).toBe("TASK-TOML-PROBE");
      expect(toml.items[0]!.status).toBe("Done");

      const capEmoji = captureOut();
      try {
        await closeTickets(["TASK-EMOJI-PROBE", "--emoji"], config);
      } finally {
        capEmoji.restore();
      }
      expect(capEmoji.text()).toContain("✅ TASK-EMOJI-PROBE");
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });
});

describe("ticket copy — checkout-to-checkout .md copies", () => {
  it("copies bytes out with --to and in with --from, --json record round-trips", async () => {
    const base = mkdtempSync(join(tmpdir(), "giwt-ticket-copy-"));
    const repo = join(base, "proj");
    const wt = join(repo, "tree", "wt");
    const wt2 = join(repo, "tree", "wt2");
    const prevCwd = process.cwd();
    try {
      initRepoWithCommit(repo);
      git(repo, "worktree", "add", "-q", "-b", "wt-branch", wt);
      git(repo, "worktree", "add", "-q", "-b", "wt2-branch", wt2);

      const content = ticketMd("copy probe", "In Progress", "copy-body-v1");
      const rel = ".plan/tickets/TASK-copy-probe.md";
      mkdirSync(join(wt, ".plan", "tickets"), { recursive: true });
      writeFileSync(join(wt, rel), content);
      writeIndexAt(wt, {
        "TASK-COPY-PROBE": { hash: "pending", extid: "TASK-COPY-PROBE", source: rel },
      });

      process.chdir(wt);
      const config = await loadConfig();

      const cap = captureOut();
      try {
        await copyTickets(["TASK-COPY-PROBE", "--to", repo, "--json"], config);
      } finally {
        cap.restore();
      }
      expect(readFileSync(join(repo, rel), "utf8")).toBe(content);
      const recs = JSON.parse(cap.text()) as Array<Record<string, unknown>>;
      expect(recs).toHaveLength(1);
      expect(recs[0]!["name"]).toBe("TASK-copy-probe.md");
      expect(String(recs[0]!["from"])).toMatch(/TASK-copy-probe\.md$/);
      expect(String(recs[0]!["to"])).toMatch(/TASK-copy-probe\.md$/);

      // Reverse direction: repo → wt2, resolved through the repo's index
      // (written by the --to copy? No — index is separate; give repo one).
      writeIndexAt(repo, {
        "TASK-COPY-PROBE": { hash: "pending", extid: "TASK-COPY-PROBE", source: rel },
      });
      process.chdir(wt2);
      const config2 = await loadConfig();
      await copyTickets(["task-copy-probe.md", "--from", repo], config2);
      expect(readFileSync(join(wt2, rel), "utf8")).toBe(content);
    } finally {
      process.chdir(prevCwd);
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses an unmerged source, naming the path", async () => {
    const fixture = makeConflictRepo("giwt-ticket-copy-conf-");
    const prevCwd = process.cwd();
    try {
      const other = join(fixture.root, "..", "other");
      initRepoWithCommit(other);
      writeIndexAt(fixture.root, {
        "TASK-CONFLICT-PROBE": {
          hash: "pending",
          extid: "TASK-CONFLICT-PROBE",
          source: fixture.rel,
        },
      });
      process.chdir(fixture.root);
      const config = await loadConfig();
      await expect(copyTickets(["TASK-CONFLICT-PROBE", "--to", other], config)).rejects.toThrow(
        /TASK-conflict-probe\.md.*unmerged/,
      );
    } finally {
      process.chdir(prevCwd);
      fixture.cleanup();
    }
  });

  it("refuses when source and target checkout are the same directory", async () => {
    const base = mkdtempSync(join(tmpdir(), "giwt-ticket-copy-same-"));
    const repo = join(base, "proj");
    const prevCwd = process.cwd();
    try {
      initRepoWithCommit(repo);
      const rel = ".plan/tickets/TASK-same-dir.md";
      mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
      writeFileSync(join(repo, rel), ticketMd("same dir", "In Progress", "b"));
      writeIndexAt(repo, {
        "TASK-SAME-DIR": { hash: "pending", extid: "TASK-SAME-DIR", source: rel },
      });
      process.chdir(repo);
      const config = await loadConfig();
      await expect(copyTickets(["TASK-SAME-DIR", "--to", repo], config)).rejects.toThrow(
        /same directory/,
      );
    } finally {
      process.chdir(prevCwd);
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("ticket 3way — conflicted ticket .md stages", () => {
  it("prints BASE/OURS/THEIRS contents plus changed verdicts on a real conflict", async () => {
    const fixture = makeConflictRepo("giwt-ticket-3way-");
    const prevCwd = process.cwd();
    try {
      process.chdir(fixture.root);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await threeWay([fixture.rel], config);
      } finally {
        cap.restore();
      }
      const text = cap.text();
      expect(text).toContain("── BASE");
      expect(text).toContain("── OURS");
      expect(text).toContain("── THEIRS");
      expect(text).toContain("base body");
      expect(text).toContain("side a body");
      expect(text).toContain("main body");
      expect(text).toMatch(/ours-vs-base: changed \(\d+ hunks?\)/);
      expect(text).toMatch(/theirs-vs-base: changed \(\d+ hunks?\)/);
      expect(text).toMatch(/ours-vs-theirs: changed \(\d+ hunks?\)/);
    } finally {
      process.chdir(prevCwd);
      fixture.cleanup();
    }
  });

  it("--json round-trips per-stage records and verdicts", async () => {
    const fixture = makeConflictRepo("giwt-ticket-3way-json-");
    const prevCwd = process.cwd();
    try {
      process.chdir(fixture.root);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await threeWay([fixture.rel, "--json"], config);
      } finally {
        cap.restore();
      }
      const parsed = JSON.parse(cap.text()) as Array<Record<string, unknown>>;
      const stages = parsed.filter((r) => r["kind"] === "stage");
      expect(stages.map((r) => r["label"])).toEqual(["BASE", "OURS", "THEIRS"]);
      for (const s of stages) {
        expect(String(s["sha"])).toMatch(/^[0-9a-f]{40}$/);
        expect(Number(s["bytes"])).toBeGreaterThan(0);
      }
      const verdicts = parsed.filter((r) => r["kind"] === "verdict");
      expect(verdicts).toHaveLength(3);
      for (const v of verdicts) {
        expect(String(v["verdict"])).toMatch(/^changed \(\d+ hunks?\)$/);
      }
    } finally {
      process.chdir(prevCwd);
      fixture.cleanup();
    }
  });

  it("--toml round-trips through Bun.TOML.parse", async () => {
    const fixture = makeConflictRepo("giwt-ticket-3way-toml-");
    const prevCwd = process.cwd();
    try {
      process.chdir(fixture.root);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await threeWay([fixture.rel, "--toml"], config);
      } finally {
        cap.restore();
      }
      const parsed = Bun.TOML.parse(cap.text()) as { items: Array<Record<string, unknown>>; };
      expect(parsed.items).toHaveLength(6);
      expect(parsed.items.filter((r) => r["kind"] === "stage")).toHaveLength(3);
      expect(parsed.items.filter((r) => r["kind"] === "verdict")).toHaveLength(3);
    } finally {
      process.chdir(prevCwd);
      fixture.cleanup();
    }
  });

  it("throws on a path with no conflict stages", async () => {
    const { repo, cleanup } = makeTicketRepo("giwt-ticket-3way-clean-");
    const prevCwd = process.cwd();
    try {
      process.chdir(repo);
      const config = await loadConfig();
      await expect(threeWay(["f.txt"], config)).rejects.toThrow(/not unmerged/);
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  it("renders (absent) for the missing base stage of an add/add conflict", async () => {
    const fixture = makeConflictRepo("giwt-ticket-3way-absent-", "add-add");
    const prevCwd = process.cwd();
    try {
      // The fixture really has no stage 1.
      expect(git(fixture.root, "ls-files", "-u", "--", fixture.rel)).not.toMatch(/\s1\s/);

      process.chdir(fixture.root);
      const config = await loadConfig();
      const cap = captureOut();
      try {
        await threeWay([fixture.rel], config);
      } finally {
        cap.restore();
      }
      const text = cap.text();
      expect(text).toContain("── BASE (absent) (0 bytes)");
      expect(text).toContain("(absent)");
      expect(text).toContain("side a body");
      expect(text).toContain("main body");
      expect(text).toMatch(/ours-vs-base: changed \(\d+ hunks?\)/);

      const capJson = captureOut();
      try {
        await threeWay([fixture.rel, "--json"], config);
      } finally {
        capJson.restore();
      }
      const parsed = JSON.parse(capJson.text()) as Array<Record<string, unknown>>;
      const baseRecord = parsed.find((r) => r["kind"] === "stage" && r["label"] === "BASE");
      expect(baseRecord).toBeDefined();
      expect(baseRecord!["sha"]).toBeUndefined();
    } finally {
      process.chdir(prevCwd);
      fixture.cleanup();
    }
  });

  it("hunkCount: identical → 0, one-line change → 1", () => {
    expect(hunkCount("a\nb\n", "a\nb\n")).toBe(0);
    expect(hunkCount("a\nb\n", "a\nc\n")).toBe(1);
  });
});
