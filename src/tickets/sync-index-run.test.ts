// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * runSync end-to-end coverage (src/tickets/sync-index.ts).
 *
 * Every test drives the real reconciler against a scratch repo built from
 * ticket .md files, a hand-written index.json, and — for registry-dependent
 * paths — real issues created through the `git issue` CLI. Each report
 * category, --fix application branch, refusal path, and lock path is
 * asserted through observable state: index.json bytes, git issue state,
 * exit code, onSummary counts, and the rendered report on stdout.
 *
 * Nothing depends on the giwt checkout itself. Registry-dependent tests
 * live in a `describe.skipIf(!GIT_ISSUE_AVAILABLE)` block gated by a probe
 * run at module load, so a machine without the CLI still runs the rest.
 */

import { describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTicketFile, runSync, type SyncSummary } from "./sync-index";
import { type IndexEntry } from "./sync-ticket";

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

function gitOut(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

/** Probe the `git issue` CLI in a throwaway repo (module load, once). */
function probeGitIssueCli(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "giwt-git-issue-probe-"));
  try {
    gitOut(dir, "init", "-q", "-b", "main");
    gitOut(dir, "config", "user.email", "giwt-test@example.com");
    gitOut(dir, "config", "user.name", "giwt test");
    gitOut(dir, "config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    gitOut(dir, "add", "-A");
    gitOut(dir, "commit", "-q", "-m", "seed");
    gitOut(dir, "issue", "ls", "--all", "--format", "oneline");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GIT_ISSUE_AVAILABLE = probeGitIssueCli();

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "giwt-sync-run-"));
}

/** Scratch git repo with one seed commit (git repo → `git issue ls` works). */
function makeRepo(dir: string): string {
  const root = join(dir, "repo");
  mkdirSync(root, { recursive: true });
  gitOut(root, "init", "-q", "-b", "main");
  gitOut(root, "config", "user.email", "giwt-test@example.com");
  gitOut(root, "config", "user.name", "giwt test");
  gitOut(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  gitOut(root, "add", "-A");
  gitOut(root, "commit", "-q", "-m", "seed");
  return root;
}

/** The hash readGitIssues would record for `title` (7-char prefix, as listed). */
function issueHash(root: string, title: string): string {
  for (const line of gitOut(root, "issue", "ls", "--all", "--format", "oneline").split("\n")) {
    const m = line.match(/^([0-9a-f]{7,40})\s+(open|closed|done)\s+(.*)$/);
    if (m?.[3] === title) return m[1]!.slice(0, 7);
  }
  throw new Error(`git issue not found: ${title}`);
}

function createIssue(root: string, title: string): string {
  gitOut(root, "issue", "create", title, "-m", "fixture issue body");
  return issueHash(root, title);
}

function closeIssue(root: string, hash: string): void {
  gitOut(root, "issue", "state", hash, "--close", "-m", "fixture close");
}

/** Current registry state of `hash`, or null when it is gone. */
function issueState(root: string, hash: string): string | null {
  for (const line of gitOut(root, "issue", "ls", "--all", "--format", "oneline").split("\n")) {
    const m = line.match(/^([0-9a-f]{7,40})\s+(open|closed|done)\s+(.*)$/);
    if (m && m[1]!.slice(0, 7) === hash) return m[2]!;
  }
  return null;
}

interface TicketSpec {
  /** Heading prefix; default TASK. */
  kind?: string;
  status?: string;
  priority?: string;
  epic?: string;
  tags?: string;
  /** Explicit `git issue: <hash>` reference appended to the file. */
  issue?: string;
  body?: string;
}

function writeTicket(
  root: string,
  filename: string,
  title: string,
  spec: TicketSpec = {},
  ticketsPath = ".plan/tickets",
): void {
  const dir = join(root, ticketsPath);
  mkdirSync(dir, { recursive: true });
  const lines = [
    `# ${spec.kind ?? "TASK"}: ${title}`,
    "",
    `**Status:** ${spec.status ?? "open"}`,
    `**Priority:** ${spec.priority ?? "medium"}`,
  ];
  if (spec.epic) lines.push(`**Epic:** ${spec.epic}`);
  if (spec.tags) lines.push(`**Tags:** ${spec.tags}`);
  lines.push("", spec.body ?? "Fixture body.");
  if (spec.issue) lines.push("", `git issue: ${spec.issue}`);
  writeFileSync(join(dir, filename), `${lines.join("\n")}\n`);
}

function indexEntry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    hash: "pending",
    extid: "TASK-X",
    type: "TASK",
    title: "Some task",
    label: "task",
    priority: "medium",
    epic: "EPIC-1",
    tags: [],
    source: "",
    ...overrides,
  };
}

function writeIndex(
  root: string,
  entries: Record<string, IndexEntry>,
  ticketsPath = ".plan/tickets",
): void {
  const dir = join(root, ticketsPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.json"), `${JSON.stringify(entries, null, 2)}\n`);
}

function readIndex(
  root: string,
  ticketsPath = ".plan/tickets",
): Record<string, IndexEntry> {
  return JSON.parse(readFileSync(join(root, ticketsPath, "index.json"), "utf8"));
}

function indexBytes(root: string, ticketsPath = ".plan/tickets"): string {
  return readFileSync(join(root, ticketsPath, "index.json"), "utf8");
}

/** Leftover atomic-write temporaries or a fix-mode lock. */
function residue(root: string, ticketsPath = ".plan/tickets"): string[] {
  return readdirSync(join(root, ticketsPath)).filter(
    (f) => f === ".index-sync.lock" || f.startsWith("index.json.tmp-"),
  );
}

/** Run `fn` with stdout+stderr captured, returning the exit code and text. */
function runCaptured(fn: () => number): { exit: number; out: string; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  try {
    return { exit: fn(), out: chunks.join("") };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

/** Rendered report rows for a category, independent of directory order. */
function listedRows(text: string, prefix: string): string[] {
  return text.split("\n").filter((line) => line.startsWith(prefix));
}

// ── Refusal + dry-run report ───────────────────────────────────

describe("runSync report and refusal paths", () => {
  test("missing tickets directory refuses without calling onSummary", () => {
    const dir = tempDir();
    try {
      const summaries: SyncSummary[] = [];
      const { exit, out } = runCaptured(() =>
        runSync(join(dir, "absent"), { onSummary: (s) => summaries.push(s) })
      );
      expect(exit).toBe(1);
      expect(summaries).toEqual([]);
      expect(out).toContain("Tickets directory not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dry-run reports orphan files and phantom entries, writing nothing", () => {
    const dir = tempDir();
    try {
      const root = join(dir, "root");
      writeTicket(root, "TASK-ORPHAN-ONE.md", "orphan one", { epic: "EPIC-1" });
      writeIndex(root, {
        "TASK-PHANTOM-ONE": indexEntry({
          extid: "TASK-PHANTOM-ONE",
          title: "phantom one",
          source: ".plan/tickets/missing.md",
        }),
      });
      const before = indexBytes(root);

      const summaries: SyncSummary[] = [];
      const { exit, out } = runCaptured(() =>
        runSync(root, { onSummary: (s) => summaries.push(s) })
      );

      expect(exit).toBe(1);
      expect(summaries).toEqual([{
        tickets: 1,
        fixesApplied: 0,
        issuesRemaining: 2,
        advisoryRemaining: 0,
      }]);
      expect(indexBytes(root)).toBe(before);
      expect(out).toContain("Orphan files (.md not in index): 1");
      expect(out).toContain("TASK-ORPHAN-ONE.md");
      expect(out).toContain("Phantom entries (index has no .md): 1");
      expect(out).toContain("TASK-PHANTOM-ONE");
      expect(out).toContain("🟢 No hash mismatches");
      expect(out).toContain("🟢 No missing hashes");
      expect(out).toContain("2 actionable issue(s) found");
      expect(out).toContain("Run with --fix to apply automatic fixes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("long category lists truncate non-verbose and expand under --verbose", () => {
    const dir = tempDir();
    try {
      const root = join(dir, "root");
      const entries: Record<string, IndexEntry> = {};
      for (let i = 1; i <= 12; i++) {
        const n = String(i).padStart(2, "0");
        writeTicket(root, `TASK-ORPHAN-${n}.md`, `orphan ${n}`, { epic: "EPIC-1" });
        entries[`TASK-PHANTOM-${n}`] = indexEntry({
          extid: `TASK-PHANTOM-${n}`,
          title: `phantom ${n}`,
          source: `.plan/tickets/gone-${n}.md`,
        });
        writeTicket(root, `TASK-BOUND-${n}.md`, `bound ${n}`);
        entries[`TASK-BOUND-${n}`] = indexEntry({
          extid: `TASK-BOUND-${n}`,
          title: `bound ${n}`,
          epic: "",
          source: `.plan/tickets/TASK-BOUND-${n}.md`,
        });
      }
      writeIndex(root, entries);

      const terse = runCaptured(() => runSync(root, {}));
      expect(terse.exit).toBe(1);
      expect(terse.out).toContain("Orphan files (.md not in index): 12");
      expect(terse.out).toContain("Phantom entries (index has no .md): 12");
      expect(terse.out).toContain("Unbound to epic (advisory, non-gating): 12");
      expect(terse.out).toContain("... and 2 more");
      // Directory order is not stable, so count rendered rows, not names.
      expect(listedRows(terse.out, "   TASK-ORPHAN-")).toHaveLength(10);
      expect(listedRows(terse.out, "   TASK-PHANTOM-")).toHaveLength(10);
      expect(listedRows(terse.out, "   TASK-BOUND-")).toHaveLength(10);

      const loud = runCaptured(() => runSync(root, { verbose: true }));
      expect(loud.exit).toBe(1);
      expect(listedRows(loud.out, "   TASK-ORPHAN-")).toHaveLength(12);
      expect(listedRows(loud.out, "   TASK-PHANTOM-")).toHaveLength(12);
      expect(listedRows(loud.out, "   TASK-BOUND-")).toHaveLength(12);
      expect(loud.out).not.toContain("... and 2 more");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrupt index.json is treated as empty and re-reported", () => {
    const dir = tempDir();
    try {
      const root = join(dir, "root");
      writeTicket(root, "TASK-CORRUPT.md", "corrupt index", { epic: "EPIC-1" });
      mkdirSync(join(root, ".plan/tickets"), { recursive: true });
      writeFileSync(join(root, ".plan/tickets/index.json"), "not json{{");

      const { exit, out } = runCaptured(() => runSync(root, {}));
      expect(exit).toBe(1);
      expect(out).toContain("Index entries:     0");
      expect(out).toContain("Orphan files (.md not in index): 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix refuses when the git issue registry is unreadable", () => {
    const dir = tempDir();
    try {
      // Plain directory: `git issue ls` cannot run here at all.
      const root = join(dir, "root");
      writeTicket(root, "TASK-NO-REGISTRY.md", "no registry", { epic: "EPIC-1" });

      const summaries: SyncSummary[] = [];
      const { exit, out } = runCaptured(() =>
        runSync(root, { fix: true, onSummary: (s) => summaries.push(s) })
      );

      expect(exit).toBe(1);
      expect(summaries).toEqual([]);
      expect(out).toContain("git issue CLI unavailable — refusing to --fix.");
      expect(out).toContain("Fix mode cannot distinguish a missing tool from stale hashes.");
      expect(existsSync(join(root, ".plan/tickets/index.json"))).toBe(false);
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix on an in-sync index reports nothing to fix and leaves bytes alone", () => {
    const dir = tempDir();
    try {
      const root = join(dir, "root");
      writeTicket(root, "TASK-OK.md", "ok ticket", { epic: "EPIC-1" });
      writeIndex(root, {
        "TASK-OK": indexEntry({
          extid: "TASK-OK",
          title: "ok ticket",
          source: ".plan/tickets/TASK-OK.md",
        }),
      });
      const before = indexBytes(root);

      const clean = runCaptured(() => runSync(root, { fix: true }));
      expect(clean.exit).toBe(0);
      expect(clean.out).toContain("Nothing to fix");
      expect(clean.out).toContain("Index is in sync");
      expect(indexBytes(root)).toBe(before);
      expect(residue(root)).toEqual([]);

      // One placeholder hash is advisory-only: still exit 0, but reported.
      writeIndex(root, {
        "TASK-OK": indexEntry({
          extid: "TASK-OK",
          title: "ok ticket",
          hash: "zzzzzzz",
          source: ".plan/tickets/TASK-OK.md",
        }),
      });
      const advisory = runCaptured(() => runSync(root, {}));
      expect(advisory.exit).toBe(0);
      expect(advisory.out).toContain("Placeholder hashes (no git issue, not a commit): 1");
      expect(advisory.out).toContain("Index is in sync (1 advisory)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parseTicketFile returns null when the path is unreadable", () => {
    const dir = tempDir();
    try {
      expect(parseTicketFile(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parseTicketFile derives the type from the filename without a heading prefix", () => {
    const dir = tempDir();
    try {
      const tickets = join(dir, ".plan/tickets");
      mkdirSync(tickets, { recursive: true });
      const typed = join(tickets, "FEAT-guess-me.md");
      writeFileSync(typed, "# Guess me\n\n**Status:** open\n");
      expect(parseTicketFile(typed)?.type).toBe("FEAT");

      const untyped = join(tickets, "mystery-file.md");
      writeFileSync(untyped, "# Mystery\n");
      expect(parseTicketFile(untyped)?.type).toBe("TASK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Registry-backed dry-run, --fix, locks ──────────────────────

describe.skipIf(!GIT_ISSUE_AVAILABLE)("runSync with a real git issue registry", () => {
  test("dry-run classifies hash, placeholder, status, link, stale and orphan issues", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      const iMismatch = createIssue(root, "TASK-999: unrelated zebra nonsense");
      const iStatus = createIssue(root, "TASK-STATUS: status thing");
      closeIssue(root, iStatus);
      const iNoHash = createIssue(root, "TASK-NOHASH: needs hash");
      const iStale = createIssue(root, "TASK-STALE: stale open issue");
      const iFloating = createIssue(root, "TASK-FLOATING-ISSUE: no index entry");

      writeTicket(root, "TASK-MISMATCH.md", "quarterly purple", { epic: "EPIC-1" });
      writeTicket(root, "TASK-PLACEHOLDER.md", "placeholder ticket", { epic: "EPIC-1" });
      writeTicket(root, "TASK-STATUS.md", "status thing", { epic: "EPIC-1" });
      writeTicket(root, "TASK-NOHASH.md", "needs hash", { epic: "EPIC-1" });
      writeTicket(root, "TASK-STALE.md", "stale open issue", { status: "done", epic: "EPIC-1" });
      writeTicket(root, "TASK-UNBOUND.md", "unbound ticket");

      writeIndex(root, {
        "TASK-MISMATCH": indexEntry({
          extid: "TASK-MISMATCH",
          title: "quarterly purple",
          hash: iMismatch,
          source: ".plan/tickets/TASK-MISMATCH.md",
        }),
        "TASK-PLACEHOLDER": indexEntry({
          extid: "TASK-PLACEHOLDER",
          title: "placeholder ticket",
          hash: "zzzzzzz",
          source: ".plan/tickets/TASK-PLACEHOLDER.md",
        }),
        "TASK-STATUS": indexEntry({
          extid: "TASK-STATUS",
          title: "status thing",
          hash: iStatus,
          status: "open",
          source: ".plan/tickets/TASK-STATUS.md",
        }),
        "TASK-NOHASH": indexEntry({
          extid: "TASK-NOHASH",
          title: "needs hash",
          hash: "pending",
          source: ".plan/tickets/TASK-NOHASH.md",
        }),
        "TASK-STALE": indexEntry({
          extid: "TASK-STALE",
          title: "stale open issue",
          hash: iStale,
          git_issue: iStale,
          status: "done",
          source: ".plan/tickets/TASK-STALE.md",
        }),
        "TASK-UNBOUND": indexEntry({
          extid: "TASK-UNBOUND",
          title: "unbound ticket",
          epic: "",
          source: ".plan/tickets/TASK-UNBOUND.md",
        }),
      });

      const terse = runCaptured(() => runSync(root, {}));
      expect(terse.exit).toBe(1);
      expect(terse.out).toContain("Hash mismatches: 1");
      expect(terse.out).toContain(
        `TASK-MISMATCH: index=${iMismatch} → git="TASK-999: unrelated zebra nonsense" (open)`,
      );
      expect(terse.out).toContain("Placeholder hashes (no git issue, not a commit): 1");
      expect(terse.out).toContain("TASK-PLACEHOLDER: index=zzzzzzz");
      expect(terse.out).toContain("Status mismatches: 1");
      expect(terse.out).toContain("TASK-STATUS: index=open vs git=done");
      expect(terse.out).toContain("Missing hashes (could be linked): 1");
      expect(terse.out).toContain(`TASK-NOHASH: → ${iNoHash}`);
      expect(terse.out).toContain(
        "Missing git_issue links (index entry has no git_issue field): 2",
      );
      expect(terse.out).toContain("Stale open git issues (index=done, git=open): 1");
      expect(terse.out).toContain(`TASK-STALE: git issue ${iStale} still open`);
      expect(terse.out).toContain("Orphan git issues (open, no index entry): 2");
      expect(terse.out).toContain(
        `${iFloating} TASK-FLOATING-ISSUE: TASK-FLOATING-ISSUE: no index entry`,
      );
      expect(terse.out).toContain("Unbound to epic (advisory, non-gating): 1");
      expect(terse.out).toContain("3 actionable issue(s) found");

      const loud = runCaptured(() => runSync(root, { verbose: true }));
      expect(loud.exit).toBe(1);
      expect(loud.out).toContain(
        `TASK-NOHASH: suggested hash=${iNoHash} (git="TASK-NOHASH: needs hash")`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("more than ten missing-hash suggestions truncate unless --verbose", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      const entries: Record<string, IndexEntry> = {};
      for (let i = 1; i <= 11; i++) {
        const n = String(i).padStart(2, "0");
        const title = `TASK-MH-${n}: missing hash ${n}`;
        const hash = createIssue(root, title);
        writeTicket(root, `TASK-MH-${n}.md`, `missing hash ${n}`, { epic: "EPIC-1" });
        entries[`TASK-MH-${n}`] = indexEntry({
          extid: `TASK-MH-${n}`,
          title: `missing hash ${n}`,
          hash: "pending",
          source: `.plan/tickets/TASK-MH-${n}.md`,
        });
        expect(hash).toMatch(/^[0-9a-f]{7}$/);
      }
      writeIndex(root, entries);

      const terse = runCaptured(() => runSync(root, {}));
      expect(terse.exit).toBe(0);
      expect(terse.out).toContain("Missing hashes (could be linked): 11");
      expect(terse.out).toContain("... and 1 more");
      expect(terse.out).toContain("Index is in sync (22 advisory)");

      const loud = runCaptured(() => runSync(root, { verbose: true }));
      expect(loud.exit).toBe(0);
      expect(loud.out).toContain("suggested hash=");
      expect(loud.out).toContain("git=\"TASK-MH-11: missing hash 11\"");
      expect(loud.out).not.toContain("... and 1 more");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix backfills, links, and adopts, then reports the remaining advisory", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      const iHash = createIssue(root, "TASK-FIXHASH: fix hash");
      const iStatus = createIssue(root, "TASK-FIXSTATUS: fix status");
      closeIssue(root, iStatus);
      const iLink = createIssue(root, "TASK-FIXLINK: fix link");
      const iAdopt = createIssue(root, "TASK-FIXORPHAN: adopt me");
      const iFallback = createIssue(root, "FIX-other: fallback ticket");
      const iClosedRef = createIssue(root, "FIX-closedref: closed reference");
      closeIssue(root, iClosedRef);

      writeTicket(root, "TASK-FIXHASH.md", "fix hash", { epic: "EPIC-1" });
      writeTicket(root, "TASK-FIXSTATUS.md", "fix status", { epic: "EPIC-1" });
      writeTicket(root, "TASK-FIXLINK.md", "fix link", { epic: "EPIC-1", issue: "abc1234" });
      writeTicket(root, "TASK-NOSTATUS.md", "no status", { status: "done", epic: "EPIC-1" });
      writeTicket(root, "TASK-FIXORPHAN.md", "adopt me", { epic: "EPIC-1" });
      writeTicket(root, "TASK-FIXORPHAN-PENDING.md", "pending orphan", { epic: "EPIC-1" });
      writeTicket(root, "TASK-FIXORPHAN-FALLBACK.md", "fallback ticket", {
        epic: "EPIC-1",
        issue: iFallback,
      });
      writeTicket(root, "TASK-FIXORPHAN-CLOSEDREF.md", "closed ref", {
        epic: "EPIC-1",
        issue: iClosedRef,
      });

      writeIndex(root, {
        "TASK-FIXHASH": indexEntry({
          extid: "TASK-FIXHASH",
          title: "fix hash",
          hash: "pending",
          source: ".plan/tickets/TASK-FIXHASH.md",
        }),
        "TASK-FIXSTATUS": indexEntry({
          extid: "TASK-FIXSTATUS",
          title: "fix status",
          hash: iStatus,
          status: "open",
          source: ".plan/tickets/TASK-FIXSTATUS.md",
        }),
        "TASK-FIXLINK": indexEntry({
          extid: "TASK-FIXLINK",
          title: "fix link",
          hash: "pending",
          source: ".plan/tickets/TASK-FIXLINK.md",
        }),
        "TASK-NOSTATUS": indexEntry({
          extid: "TASK-NOSTATUS",
          title: "no status",
          hash: "pending",
          source: ".plan/tickets/TASK-NOSTATUS.md",
        }),
      });

      const summaries: SyncSummary[] = [];
      const { exit, out } = runCaptured(() =>
        runSync(root, { fix: true, onSummary: (s) => summaries.push(s) })
      );

      expect(exit).toBe(0);
      expect(out).toContain("🔧 Applying fixes...");
      expect(out).toContain("Changes:");
      expect(out).toContain(`Wrote ${join(root, ".plan/tickets/index.json")}`);
      expect(out).toContain(`TASK-FIXHASH: added hash ${iHash}`);
      expect(out).toContain("TASK-FIXSTATUS: status open → done");
      expect(out).toContain(`TASK-FIXLINK: added git_issue = ${iLink}`);
      expect(out).toContain("TASK-NOSTATUS: backfilled status (was undefined) → \"done\"");
      expect(out).toContain("TASK-FIXORPHAN: added to index (from orphan file)");
      // The leftovers are advisory: the FIX-other orphan issue is claimed by
      // the adopted fallback ticket, and the report now also itemizes the
      // plan-only .md files (importable) and the stale abc1234 ref (dangling).
      expect(out).toContain("Index is in sync (5 advisory remaining)");

      const fixed = readIndex(root);
      expect(Object.keys(fixed)).toEqual([...Object.keys(fixed)].sort());
      expect(fixed["TASK-FIXHASH"]).toMatchObject({ hash: iHash, git_issue: iHash });
      expect(fixed["TASK-FIXSTATUS"]).toMatchObject({ status: "done", git_issue: iStatus });
      expect(fixed["TASK-FIXLINK"]).toMatchObject({ hash: "pending", git_issue: iLink });
      expect(fixed["TASK-NOSTATUS"]?.status).toBe("done");

      expect(fixed["TASK-FIXORPHAN"]).toMatchObject({
        hash: iAdopt,
        git_issue: iAdopt,
        source: ".plan/tickets/TASK-FIXORPHAN.md",
        title: "adopt me",
      });
      expect(fixed["TASK-FIXORPHAN-PENDING"]?.hash).toBe("pending");
      expect(fixed["TASK-FIXORPHAN-PENDING"]?.git_issue).toBeUndefined();
      expect(fixed["TASK-FIXORPHAN-FALLBACK"]?.hash).toBe(iFallback);
      expect(fixed["TASK-FIXORPHAN-CLOSEDREF"]?.hash).toBe("pending");
      expect(fixed["TASK-FIXORPHAN-CLOSEDREF"]?.git_issue).toBeUndefined();

      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.tickets).toBe(8);
      expect(summaries[0]!.issuesRemaining).toBe(0);
      // 4 plan-only .md files (importable) + the stale abc1234 ref (dangling).
      expect(summaries[0]!.advisoryRemaining).toBe(5);
      expect(summaries[0]!.fixesApplied).toBeGreaterThan(0);
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix closes a stale open issue and re-checks against the pre-fix snapshot", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      const iClose = createIssue(root, "TASK-FIXCLOSE: fix close");
      writeTicket(root, "TASK-FIXCLOSE.md", "fix close", { status: "done", epic: "EPIC-1" });
      writeIndex(root, {
        "TASK-FIXCLOSE": indexEntry({
          extid: "TASK-FIXCLOSE",
          title: "fix close",
          hash: iClose,
          git_issue: iClose,
          status: "done",
          source: ".plan/tickets/TASK-FIXCLOSE.md",
        }),
      });

      const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

      // The close really happened; the post-fix summary re-reads the
      // registry, so the resolved ticket no longer counts as stale.
      expect(exit).toBe(0);
      expect(out).toContain(`TASK-FIXCLOSE: closed git issue ${iClose}`);
      expect(out).toContain("Index is in sync");
      expect(issueState(root, iClose)).toBe("closed");
      expect(readIndex(root)["TASK-FIXCLOSE"]).toMatchObject({
        hash: iClose,
        git_issue: iClose,
      });
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix relinks an index hash that points at a closed issue to its open duplicate", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      const iOld = createIssue(root, "TASK-RELINK: relink me");
      closeIssue(root, iOld);
      const iNew = createIssue(root, "TASK-RELINK: relink me again");

      writeTicket(root, "TASK-RELINK.md", "relink me", { status: "done", epic: "EPIC-1" });
      writeIndex(root, {
        "TASK-RELINK": indexEntry({
          extid: "TASK-RELINK",
          title: "relink me",
          hash: iOld,
          git_issue: iNew,
          status: "done",
          source: ".plan/tickets/TASK-RELINK.md",
        }),
      });

      const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

      expect(out).toContain(`TASK-RELINK: relinked closed ${iOld} → open ${iNew}`);
      expect(readIndex(root)["TASK-RELINK"]).toMatchObject({ hash: iNew, git_issue: iNew });
      expect(issueState(root, iOld)).toBe("closed");

      // The relink target was reported stale and closed in the same pass;
      // the summary re-reads the registry, so the fixed state exits 0.
      expect(exit).toBe(0);
      expect(out).toContain(`TASK-RELINK: closed git issue ${iNew}`);
      expect(issueState(root, iNew)).toBe("closed");
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix resolves placeholder hashes and rewrites the .md reference", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      const p1 = createIssue(root, "TASK-PH1: placeholder one");
      const p2 = createIssue(root, "TASK-PH2: placeholder two");

      writeTicket(root, "TASK-PH1.md", "placeholder one", { epic: "EPIC-1" });
      writeTicket(root, "TASK-PH2.md", "placeholder two", {
        epic: "EPIC-1",
        issue: "abc1234",
      });
      writeTicket(root, "TASK-PH3.md", "placeholder three", { epic: "EPIC-1" });

      writeIndex(root, {
        "TASK-PH1": indexEntry({
          extid: "TASK-PH1",
          title: "placeholder one",
          hash: "zzzzzzz",
          source: ".plan/tickets/TASK-PH1.md",
        }),
        "TASK-PH2": indexEntry({
          extid: "TASK-PH2",
          title: "placeholder two",
          hash: "qqqqqqq",
          source: ".plan/tickets/TASK-PH2.md",
        }),
        "TASK-PH3": indexEntry({
          extid: "TASK-PH3",
          title: "placeholder three",
          hash: "wwwwwww",
          source: ".plan/tickets/TASK-PH3.md",
        }),
      });

      const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

      expect(exit).toBe(0);
      expect(out).toContain(`TASK-PH1: replaced placeholder zzzzzzz → ${p1}`);
      expect(out).toContain(`TASK-PH2: replaced placeholder qqqqqqq → ${p2}`);
      expect(out).toContain("TASK-PH1: linked .md to git issue");
      expect(out).toContain(
        "TASK-PH3: SKIPPED placeholder fix — no matching git issue (orphan left in place)",
      );

      const fixed = readIndex(root);
      expect(fixed["TASK-PH1"]).toMatchObject({ hash: p1, git_issue: p1 });
      expect(fixed["TASK-PH2"]).toMatchObject({ hash: p2, git_issue: p2 });
      expect(fixed["TASK-PH3"]?.hash).toBe("wwwwwww");

      // PH1 had no reference → appended; PH2's stale ref was replaced.
      const ph1 = readFileSync(join(root, ".plan/tickets/TASK-PH1.md"), "utf8");
      expect(ph1).toContain(`git issue: ${p1}`);
      const ph2 = readFileSync(join(root, ".plan/tickets/TASK-PH2.md"), "utf8");
      expect(ph2).toContain(`git issue: ${p2}`);
      expect(ph2).not.toContain("abc1234");
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix relocates a phantom source found under a custom tickets path", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      writeTicket(root, "TASK-GHOST1.md", "ghost one", { epic: "EPIC-1" }, ".plan/tix");
      // Second phantom resolves only at the lowercase-name pattern.
      writeTicket(root, "task-ghost2.md", "ghost two", { epic: "EPIC-1" }, ".plan/tix");
      writeIndex(
        root,
        {
          "TASK-GHOST1": indexEntry({
            extid: "TASK-GHOST1",
            title: "ghost one",
            source: ".plan/tickets/old-place.md",
          }),
          "TASK-GHOST2": indexEntry({
            extid: "TASK-GHOST2",
            title: "ghost two",
            source: ".plan/tickets/old-place-2.md",
          }),
        },
        ".plan/tix",
      );

      const { exit, out } = runCaptured(() =>
        runSync(root, { fix: true, ticketsPath: ".plan/tix" })
      );

      // The relocated sources are reported, but they still cannot resolve on
      // the next pass, so actionable issues remain.
      expect(exit).toBe(1);
      expect(out).toContain("TASK-GHOST1: fixed source path to TASK-GHOST1.md");
      expect(out).toContain("TASK-GHOST2: fixed source path to task-ghost2.md");
      expect(out).toContain("2 actionable issue(s) remain");
      const relocated = readIndex(root, ".plan/tix");
      expect(relocated["TASK-GHOST1"]?.source).toBe(".plan/tickets/TASK-GHOST1.md");
      expect(relocated["TASK-GHOST2"]?.source).toBe(".plan/tickets/task-ghost2.md");
      expect(residue(root, ".plan/tix")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix refuses while a live lock is held", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      writeTicket(root, "TASK-LOCKED.md", "locked orphan", { epic: "EPIC-1" });
      const lock = join(root, ".plan/tickets/.index-sync.lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, "owner.pid"), `${process.pid}\n`);

      const summaries: SyncSummary[] = [];
      const { exit, out } = runCaptured(() =>
        runSync(root, { fix: true, onSummary: (s) => summaries.push(s) })
      );

      expect(exit).toBe(1);
      expect(summaries).toEqual([]);
      expect(out).toContain(`Another index sync is in progress (lock: ${lock}).`);
      expect(existsSync(join(lock, "owner.pid"))).toBe(true);
      expect(existsSync(join(root, ".plan/tickets/index.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix reclaims a lock whose owner pid is unreadable", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      writeTicket(root, "TASK-STALE-LOCK.md", "stale lock orphan", { epic: "EPIC-1" });
      const lock = join(root, ".plan/tickets/.index-sync.lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, "owner.pid"), "not-a-pid\n");

      const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

      expect(exit).toBe(0);
      expect(out).toContain("Removed stale index-sync lock left by a dead process");
      expect(readIndex(root)["TASK-STALE-LOCK"]?.hash).toBe("pending");
      expect(existsSync(lock)).toBe(false);
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix reclaims a lock directory with no owner pid at all", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      writeTicket(root, "TASK-EMPTY-LOCK.md", "empty lock orphan", { epic: "EPIC-1" });
      const lock = join(root, ".plan/tickets/.index-sync.lock");
      mkdirSync(lock, { recursive: true });

      const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

      expect(exit).toBe(0);
      expect(out).toContain("Removed stale index-sync lock left by a dead process");
      expect(existsSync(lock)).toBe(false);
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--fix reclaims a lock whose owner pid is dead", () => {
    const dir = tempDir();
    try {
      const root = makeRepo(dir);
      writeTicket(root, "TASK-DEAD-LOCK.md", "dead lock orphan", { epic: "EPIC-1" });
      const lock = join(root, ".plan/tickets/.index-sync.lock");
      mkdirSync(lock, { recursive: true });
      // pid_max + 1 can never be a live process.
      let deadPid = 4_194_305;
      try {
        deadPid = Number(readFileSync("/proc/sys/kernel/pid_max", "utf8").trim()) + 1;
      } catch {
        // non-Linux: keep the Linux default bound
      }
      writeFileSync(join(lock, "owner.pid"), `${deadPid}\n`);

      const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

      expect(exit).toBe(0);
      expect(out).toContain("Removed stale index-sync lock left by a dead process");
      expect(existsSync(lock)).toBe(false);
      expect(residue(root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
