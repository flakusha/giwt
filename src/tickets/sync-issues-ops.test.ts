// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Issue-lifecycle drift coverage for runSync (src/tickets/sync-index.ts):
 * import (.md → git issue), foreign issues (--import-back), title drift
 * (reclassify/move), .md status rewrite, and the report-only categories
 * (duplicates, dangling refs, unparsed foreign issues).
 *
 * Resource contract (parallel-safe): every test builds its own mkdtemp repo
 * under the giwt scratch root (/tmp/giwt/) and removes it in afterEach — no fixed paths, no shared
 * fixtures, no env mutation. Registry-dependent tests run the real
 * `git issue` CLI, gated by a module-load probe, mirroring
 * sync-index-run.test.ts.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { lint } from "markdownlint/promise";
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
import { join } from "node:path";
import { runValidate } from "../plan/validate";
import { scratchRoot } from "../utils/scratch-tmp";
import { runSync, vocabStatusTarget } from "./sync-index";
import { type IndexEntry } from "./sync-ticket";

// ── Fixture helpers (unique per test; hermetic git env) ────────

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

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

/** Probe the `git issue` CLI once at module load in a throwaway repo. */
function probeGitIssueCli(): boolean {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-issue-ops-probe-"));
  try {
    gitOut(dir, "init", "-q", "-b", "main");
    gitOut(dir, "config", "user.email", "giwt-test@example.com");
    gitOut(dir, "config", "user.name", "giwt test");
    gitOut(dir, "config", "commit.gpgsign", "false");
    gitOut(dir, "commit", "-q", "--allow-empty", "-m", "seed");
    gitOut(dir, "issue", "ls", "--all", "--format", "oneline");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GIT_ISSUE_AVAILABLE = probeGitIssueCli();

/** Scratch repo; caller owns the temp dir (pushed to `temps`). */
function makeRepo(): string {
  const dir = mkdtempSync(join(scratchRoot(), "giwt-issue-ops-"));
  temps.push(dir);
  const root = join(dir, "repo");
  mkdirSync(root, { recursive: true });
  gitOut(root, "init", "-q", "-b", "main");
  gitOut(root, "config", "user.email", "giwt-test@example.com");
  gitOut(root, "config", "user.name", "giwt test");
  gitOut(root, "config", "commit.gpgsign", "false");
  gitOut(root, "commit", "-q", "--allow-empty", "-m", "seed");
  return root;
}

interface IssueRow {
  hash: string;
  status: string;
  title: string;
}

function issueLines(root: string): IssueRow[] {
  return gitOut(root, "issue", "ls", "--all", "--format", "oneline")
    .split("\n")
    .map((line) => line.match(/^([0-9a-f]{7,40})\s+(open|closed|done)\s+(.*)$/))
    .filter((m) => m !== null)
    .map((m) => ({ hash: m![1]!.slice(0, 7), status: m![2]!, title: m![3]! }));
}

function issueHash(root: string, title: string): string {
  const hit = issueLines(root).find((i) => i.title === title);
  if (!hit) throw new Error(`git issue not found: ${title}`);
  return hit.hash;
}

function createIssue(root: string, title: string): string {
  gitOut(root, "issue", "create", title, "-m", "fixture issue body");
  return issueHash(root, title);
}

interface TicketSpec {
  kind?: string;
  status?: string;
  epic?: string;
  issue?: string;
  ticketsPath?: string;
}

function writeTicket(root: string, filename: string, title: string, spec: TicketSpec = {}): void {
  const dir = join(root, spec.ticketsPath ?? ".plan/tickets");
  mkdirSync(dir, { recursive: true });
  const lines = [
    `# ${spec.kind ?? "TASK"}: ${title}`,
    "",
    `**Status:** ${spec.status ?? "open"}`,
    "**Priority:** medium",
  ];
  if (spec.epic) lines.push(`**Epic:** ${spec.epic}`);
  lines.push("", "Fixture body.");
  if (spec.issue) lines.push("", `git issue: ${spec.issue}`);
  writeFileSync(join(dir, filename), `${lines.join("\n")}\n`);
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

/** Run `fn` with stdout+stderr captured. */
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

function readIndex(root: string, ticketsPath = ".plan/tickets"): Record<string, IndexEntry> {
  return JSON.parse(readFileSync(join(root, ticketsPath, "index.json"), "utf8"));
}

/** Rendered report rows for a prefix, independent of directory order. */
function listedRows(text: string, prefix: string): string[] {
  return text.split("\n").filter((line) => line.startsWith(prefix));
}

// ── Registry-independent classification ────────────────────────

describe("issue lifecycle drift classification (no registry)", () => {
  test("no registry issues → every .md is importable, exit gates on it", () => {
    const root = makeRepo();
    writeTicket(root, "TASK-imp.md", "Do the thing");
    writeIndex(root, {});

    const { exit, out } = runCaptured(() => runSync(root, {}));

    expect(out).toContain("Importable tickets (.md, no git issue): 1");
    expect(out).toContain("TASK-IMP: .plan/tickets/TASK-imp.md");
    expect(out).toContain("--fix --import");
    expect(exit).toBe(1); // the orphan .md is actionable (adoption gate)
  });

  test("epic .md in .plan/epics is scanned and classified, not invisible", () => {
    const root = makeRepo();
    writeTicket(root, "EPIC-alpha.md", "Alpha epic", {
      kind: "EPIC",
      ticketsPath: ".plan/epics",
    });
    writeIndex(root, {});

    const { exit, out } = runCaptured(() => runSync(root, {}));

    expect(out).toContain("EPIC-ALPHA: .plan/epics/EPIC-alpha.md");
    expect(exit).toBe(1);
  });
});

// ── Registry-dependent behavior ────────────────────────────────

describe.skipIf(!GIT_ISSUE_AVAILABLE)("issue lifecycle drift with real registry", () => {
  test("--fix --import creates a ticket issue: links .md + index, idempotent", () => {
    const root = makeRepo();
    writeTicket(root, "TASK-imp.md", "Do the thing");
    writeIndex(root, {});

    const first = runCaptured(() => runSync(root, { fix: true, import: true }));

    expect(first.out).toContain("TASK-IMP: imported .plan/tickets/TASK-imp.md → git issue");
    const created = issueLines(root).find((i) => i.title === "TASK-IMP: Do the thing");
    expect(created).toBeDefined();
    expect(created!.status).toBe("open");
    expect(readFileSync(join(root, ".plan/tickets/TASK-imp.md"), "utf8"))
      .toContain(`git issue: ${created!.hash}`);
    expect(readIndex(root)["TASK-IMP"]).toMatchObject({
      hash: created!.hash,
      git_issue: created!.hash,
      source: ".plan/tickets/TASK-imp.md",
    });

    // Idempotency: a second fix run has nothing left to do.
    const second = runCaptured(() => runSync(root, { fix: true, import: true }));
    expect(second.out).toContain("Nothing to fix");
    expect(second.exit).toBe(0);
    expect(issueLines(root)).toHaveLength(1);
  });

  test("plain --fix never mass-creates issues for plan-only files", () => {
    // Regression pin for BUG-plan-sync-fix-creates-orphan-git-issues: import
    // is opt-in, so a repo of plan-only .md files stays registry-untouched.
    const root = makeRepo();
    writeTicket(root, "TASK-imp.md", "Do the thing");
    writeIndex(root, {});

    const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

    expect(out).toContain("Importable tickets (.md, no git issue): 1");
    expect(out).toContain("--fix --import");
    expect(issueLines(root)).toHaveLength(0);
    expect(exit).toBe(0); // importable is advisory
  });

  test("--fix imports an epic .md with EPIC type and epic-dir source", () => {
    const root = makeRepo();
    writeTicket(root, "EPIC-alpha.md", "Alpha epic", {
      kind: "EPIC",
      ticketsPath: ".plan/epics",
    });
    writeIndex(root, {});

    const { exit, out } = runCaptured(() => runSync(root, { fix: true, import: true }));

    expect(out).toContain("EPIC-ALPHA: imported .plan/epics/EPIC-alpha.md → git issue");
    expect(issueLines(root)[0]!.title).toBe("EPIC-ALPHA: Alpha epic");
    expect(readIndex(root)["EPIC-ALPHA"]).toMatchObject({
      type: "EPIC",
      source: ".plan/epics/EPIC-alpha.md",
    });
    expect(exit).toBe(0);
  });

  test("foreign issue: report-only by default, imported back with --import-back", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-foreign: registry-only work");
    writeIndex(root, {});

    const plain = runCaptured(() => runSync(root, { fix: true }));
    expect(plain.out).toContain("Foreign issues (open in registry, no .plan/ reflection): 1");
    expect(plain.out).toContain("--import-back");
    expect(existsSync(join(root, ".plan/tickets/TASK-FOREIGN.md"))).toBe(false);

    const back = runCaptured(() => runSync(root, { fix: true, importBack: true }));
    expect(back.out).toContain(
      `TASK-FOREIGN: imported back git issue ${hash} → .plan/tickets/TASK-FOREIGN.md`,
    );
    const md = readFileSync(join(root, ".plan/tickets/TASK-FOREIGN.md"), "utf8");
    expect(md).toContain("# TASK: registry-only work");
    expect(md).toContain(`git issue: ${hash}`);
    expect(readIndex(root)["TASK-FOREIGN"]).toMatchObject({
      hash,
      git_issue: hash,
      type: "TASK",
    });
    expect(back.exit).toBe(0);

    // Idempotent: the imported ticket now owns its issue.
    const again = runCaptured(() => runSync(root, { fix: true }));
    expect(again.out).toContain("Nothing to fix");
  });

  test("import-back .md passes the markdownlint gate unchanged", async () => {
    const root = makeRepo();
    createIssue(root, "TASK-lint-back: registry only work");
    writeIndex(root, {});

    const { exit } = runCaptured(() => runSync(root, { fix: true, importBack: true }));
    expect(exit).toBe(0);

    const mdPath = join(root, ".plan/tickets/TASK-LINT-BACK.md");
    const md = readFileSync(mdPath, "utf8");
    // Generator contract: exactly one trailing newline.
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
    // And the file lints clean under the repo gate's rule set (MD013 off).
    const results = await lint({ files: [mdPath], config: { MD013: false } });
    expect(results[mdPath] ?? []).toEqual([]);
  });

  test("unparsed foreign issue is report-only even with --import-back", () => {
    const root = makeRepo();
    createIssue(root, "random conversation note without extid");
    writeIndex(root, {});

    const { out } = runCaptured(() => runSync(root, { fix: true, importBack: true }));

    expect(out).toContain("Foreign issues without TYPE-extid (manual only): 1");
    expect(out).not.toContain("imported back");
  });

  test("title drift: reclassified ticket gets its issue renamed and relinked", () => {
    const root = makeRepo();
    // Registry holds the ticket under its old TASK prefix; the plan file was
    // moved/reclassified to BUG with the same slug.
    const hash = createIssue(root, "TASK-old-slug: stale classification");
    writeTicket(root, "BUG-old-slug.md", "stale classification");
    writeIndex(root, {});

    const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

    expect(out).toContain(
      `BUG-OLD-SLUG: renamed issue ${hash} (TASK-OLD-SLUG → BUG-OLD-SLUG)`,
    );
    expect(issueLines(root).find((i) => i.hash === hash)!.title)
      .toBe("BUG-OLD-SLUG: stale classification");
    expect(readFileSync(join(root, ".plan/tickets/BUG-old-slug.md"), "utf8"))
      .toContain(`git issue: ${hash}`);
    expect(readIndex(root)["BUG-OLD-SLUG"]).toMatchObject({ hash, git_issue: hash });
    expect(exit).toBe(0);
  });

  test("duplicate open issues for one extid are reported, never auto-closed", () => {
    const root = makeRepo();
    const h1 = createIssue(root, "TASK-dup: first copy");
    const h2 = createIssue(root, "TASK-dup: second copy");
    writeTicket(root, "TASK-dup.md", "dup work", { issue: h1 });
    writeIndex(root, {
      "TASK-DUP": indexEntry({
        extid: "TASK-DUP",
        hash: h1,
        git_issue: h1,
        title: "dup work",
        source: ".plan/tickets/TASK-dup.md",
      }),
    });

    const { out } = runCaptured(() => runSync(root, { fix: true }));

    expect(out).toContain("Duplicate open issues (manual dedupe): 1");
    const dupLine = out.split("\n").find((l) => l.startsWith(`   TASK-DUP: `));
    expect(new Set(dupLine?.slice("   TASK-DUP: ".length).split(", "))).toEqual(
      new Set([h1, h2]),
    );
    expect(issueLines(root).filter((i) => i.hash === h2)[0]!.status).toBe("open");
  });

  test("dangling .md issue ref is reported and blocks import", () => {
    const root = makeRepo();
    writeTicket(root, "TASK-dangle.md", "dangling ref", { issue: "dead123" });
    writeIndex(root, {});

    const { out } = runCaptured(() => runSync(root, { fix: true }));

    expect(out).toContain("Dangling .md issue refs (hash not in registry): 1");
    expect(out).toContain("TASK-DANGLE: git issue: dead123");
    // No issue must be created behind the dead ref's back.
    expect(issueLines(root)).toHaveLength(0);
  });

  test("import-back skips when the target .md already exists", () => {
    const root = makeRepo();
    createIssue(root, "TASK-foreign: registry-only work");
    writeTicket(root, "TASK-FOREIGN.md", "human wrote this first");
    writeIndex(root, {});

    // The plan file exists but is NOT in the index yet, so the issue still
    // classifies as foreign until adoption; import-back must not clobber it.
    writeIndex(root, {});
    const { out } = runCaptured(() => runSync(root, { fix: true, importBack: true }));

    // Adoption (orphanFiles fix) claims the file first, so the issue is no
    // longer foreign by the time import-back runs — assert no clobber either
    // way: the file content is the human's, not the generated template.
    expect(readFileSync(join(root, ".plan/tickets/TASK-FOREIGN.md"), "utf8"))
      .toContain("human wrote this first");
    expect(out).not.toContain("imported back");
  });

  test("read-only issue store: import and close failures are reported, run fails", () => {
    const root = makeRepo();
    const doneHash = createIssue(root, "TASK-gone: finished work");
    const driftHash = createIssue(root, "TASK-old-drift: moved work");
    const staleHash = createIssue(root, "TASK-frozen-status: closed work");
    gitOut(root, "issue", "state", staleHash, "--close", "-m", "done");
    writeTicket(root, "TASK-new.md", "brand new");
    writeTicket(root, "BUG-old-drift.md", "moved work");
    const frozenMd = join(root, ".plan/tickets/TASK-frozen-status.md");
    writeTicket(root, "TASK-frozen-status.md", "closed work", {
      status: "open",
      issue: staleHash,
    });
    writeIndex(root, {
      "TASK-GONE": indexEntry({
        extid: "TASK-GONE",
        hash: doneHash,
        git_issue: doneHash,
        status: "done",
        title: "finished work",
        source: ".plan/tickets/TASK-gone.md",
      }),
      "TASK-FROZEN-STATUS": indexEntry({
        extid: "TASK-FROZEN-STATUS",
        hash: staleHash,
        git_issue: staleHash,
        status: "done",
        title: "closed work",
        source: ".plan/tickets/TASK-frozen-status.md",
      }),
    });

    // The .md is readable (scanned fine) but read-only, so the post-mismatch
    // Status rewrite fails — covering the rewrite failure path.
    chmodSync(frozenMd, 0o444);

    // Freeze the store so the create/edit/close subprocesses all fail.
    const gitDir = join(root, ".git");
    const freeze = (dir: string, ro: boolean): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        chmodSync(p, ro ? 0o555 : 0o755);
        if (entry.isDirectory()) freeze(p, ro);
      }
      chmodSync(dir, ro ? 0o555 : 0o755);
    };
    freeze(gitDir, true);
    try {
      const { exit, out } = runCaptured(() => runSync(root, { fix: true, import: true }));

      expect(out).toContain("TASK-NEW: FAILED to import");
      expect(out).toContain("TASK-GONE: FAILED to close git issue");
      expect(out).toContain("TASK-FROZEN-STATUS: FAILED to rewrite .md status");
      expect(exit).toBe(1); // failures remain actionable
      expect(issueLines(root).find((i) => i.hash === doneHash)!.status).toBe("open");
      expect(issueLines(root).find((i) => i.hash === driftHash)!.title)
        .toBe("TASK-old-drift: moved work"); // rename never landed
    } finally {
      chmodSync(frozenMd, 0o644);
      freeze(gitDir, false);
    }
  });

  test("import-back skips a pre-existing unscanned plan file; unparsed truncates", () => {
    const root = makeRepo();
    // A .md under the DEFAULT tickets dir that the custom ticketsPath does
    // not scan: the issue is foreign, but import-back must not clobber it.
    mkdirSync(join(root, ".plan/tickets"), { recursive: true });
    writeFileSync(join(root, ".plan/tickets/TASK-SKIP.md"), "human file\n");
    createIssue(root, "TASK-skip: keep me");
    for (let n = 1; n <= 12; n++) {
      createIssue(root, `just a note ${n} without extid`);
    }
    mkdirSync(join(root, ".plan/tix"), { recursive: true });
    writeIndex(root, {}, ".plan/tix");

    const { out } = runCaptured(() =>
      runSync(root, { fix: true, importBack: true, ticketsPath: ".plan/tix" })
    );

    expect(out).toContain("SKIPPED import-back — TASK-SKIP.md already exists");
    expect(readFileSync(join(root, ".plan/tickets/TASK-SKIP.md"), "utf8")).toBe("human file\n");
    expect(out).toContain("Foreign issues without TYPE-extid (manual only): 12");
    expect(out).toContain("... and 2 more");
  });

  test("importable and foreign lists truncate to 10 rows non-verbose", () => {
    const root = makeRepo();
    for (let n = 1; n <= 12; n++) {
      writeTicket(root, `TASK-imp-${n}.md`, `plan only ${n}`);
      createIssue(root, `TASK-frn-${n}: registry only ${n}`);
    }
    writeIndex(root, {});

    const terse = runCaptured(() => runSync(root, { fix: true }));
    expect(terse.out).toContain("Importable tickets (.md, no git issue): 12");
    expect(terse.out).toContain("... and 2 more");
    expect(terse.out).toContain("--fix --import");
    expect(terse.out).toContain("Foreign issues (open in registry, no .plan/ reflection): 12");
    expect(terse.out).toContain("--import-back");
    // Count rows only inside each section — extids also appear in other
    // sections (orphans, unbound-to-epic).
    const impSection = terse.out.split("Importable tickets")[1]!.split("\n\n")[0]!;
    const frnSection = terse.out.split("Foreign issues")[1]!.split("\n\n")[0]!;
    expect(listedRows(impSection, "   TASK-IMP-")).toHaveLength(10);
    expect(impSection).toContain("... and 2 more");
    expect(frnSection.split(/\n {3}[0-9a-f]{7}/)).toHaveLength(11); // 10 + tail

    const loud = runCaptured(() => runSync(root, { verbose: true }));
    const loudImp = loud.out.split("Importable tickets")[1]!.split("\n\n")[0]!;
    const loudFrn = loud.out.split("Foreign issues")[1]!.split("\n\n")[0]!;
    expect(listedRows(loudImp, "   TASK-IMP-")).toHaveLength(12);
    expect(loudFrn.split(/\n {3}[0-9a-f]{7}/)).toHaveLength(13); // 12 + tail
  });

  test("stale .md status line is rewritten to the authoritative index status", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-stale-status: done work");
    gitOut(root, "issue", "state", hash, "--close", "-m", "done");
    writeTicket(root, "TASK-stale-status.md", "done work", {
      status: "open",
      issue: hash,
    });
    writeIndex(root, {
      "TASK-STALE-STATUS": indexEntry({
        extid: "TASK-STALE-STATUS",
        hash,
        git_issue: hash,
        status: "done",
        title: "done work",
        source: ".plan/tickets/TASK-stale-status.md",
      }),
    });

    const { exit, out } = runCaptured(() => runSync(root, { fix: true }));

    expect(out).toContain("TASK-STALE-STATUS: .md status open → Done");
    const lines = readFileSync(join(root, ".plan/tickets/TASK-stale-status.md"), "utf8")
      .split("\n");
    expect(lines.find((l) => l.startsWith("**Status:**"))).toBe("**Status:** Done");
    expect(exit).toBe(0);
  });

  test("registry-driven Done stamp carries provenance: registry tip sha + author in a Resolved line", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-prov: provenance work");
    gitOut(root, "issue", "state", hash, "--close", "-m", "done");
    writeTicket(root, "TASK-prov.md", "provenance work", {
      status: "open",
      issue: hash,
    });
    writeIndex(root, {
      "TASK-PROV": indexEntry({
        extid: "TASK-PROV",
        hash,
        git_issue: hash,
        status: "done",
        title: "provenance work",
        source: ".plan/tickets/TASK-prov.md",
      }),
    });

    const { exit } = runCaptured(() => runSync(root, { fix: true }));

    const text = readFileSync(join(root, ".plan/tickets/TASK-prov.md"), "utf8");
    const resolved = text.split("\n").find((l) => l.startsWith("**Resolved:**"));
    expect(resolved).toBeDefined();
    expect(resolved).toContain("registry-driven close");
    expect(resolved).toContain(`git issue ${hash}`);
    // Registry tip: short sha + the fixture repo's committer name.
    expect(resolved).toMatch(/registry tip: [0-9a-f]{7,} giwt test /);
    expect(exit).toBe(0);

    // Idempotent: a second --fix run must not double-stamp.
    runCaptured(() => runSync(root, { fix: true }));
    const after = readFileSync(join(root, ".plan/tickets/TASK-prov.md"), "utf8");
    expect(after.split("\n").filter((l) => l.startsWith("**Resolved:**"))).toHaveLength(1);
  });

  test("non-done status rewrites carry no Resolved stamp", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-nodone: still open");
    writeTicket(root, "TASK-nodone.md", "still open", {
      status: "Blocked",
      issue: hash,
    });
    writeIndex(root, {
      "TASK-NODONE": indexEntry({
        extid: "TASK-NODONE",
        hash,
        git_issue: hash,
        status: "open",
        title: "still open",
        source: ".plan/tickets/TASK-nodone.md",
      }),
    });

    const { exit } = runCaptured(() => runSync(root, { fix: true }));

    const text = readFileSync(join(root, ".plan/tickets/TASK-nodone.md"), "utf8");
    expect(text).not.toContain("**Resolved:**");
    expect(exit).toBe(0);
  });

  test("dual-status Shape B .md backfills done, then closes the linked issue on the next fix", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-dual: dual status");
    const dir = join(root, ".plan/tickets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TASK-dual.md"),
      "# TASK: dual status\n\n**Status:** Not Started\n**Status**: duplicate-of-epic-x\n\ngit issue: "
        + hash + "\n",
    );
    writeIndex(root, {
      "TASK-DUAL": indexEntry({
        extid: "TASK-DUAL",
        hash,
        git_issue: hash,
        source: ".plan/tickets/TASK-dual.md",
      }),
    });

    // First fix: the any-done-line parse backfills `done` into the index
    // (the stale-open close fires on the NEXT pass — reconcile ran before
    // the backfill).
    runCaptured(() => runSync(root, { fix: true }));
    expect(readIndex(root)["TASK-DUAL"]?.status).toBe("done");

    const second = runCaptured(() => runSync(root, { fix: true }));
    expect(second.out).toContain("TASK-DUAL: closed git issue");
    expect(issueLines(root).find((i) => i.hash === hash)?.status).toBe("closed");
  });

  test("appended done-marker outranks a lagging open index — flipped and closed in one pass", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-lag: lagging index");
    const dir = join(root, ".plan/tickets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TASK-lag.md"),
      "# TASK: lagging index\n\n**Status:** open\n**Status**: done\n\ngit issue: " + hash + "\n",
    );
    writeIndex(root, {
      "TASK-LAG": indexEntry({
        extid: "TASK-LAG",
        hash,
        git_issue: hash,
        status: "open",
        title: "lagging index",
        source: ".plan/tickets/TASK-lag.md",
      }),
    });

    // First fix converges in ONE pass: index flips to done and the linked
    // open issue is closed inside applyFixes (reconcile ran before the
    // flip, so the staleOpenGitIssues list does not carry it yet).
    const first = runCaptured(() => runSync(root, { fix: true }));
    expect(first.out).toContain("TASK-LAG: index status open → done (appended .md marker)");
    expect(first.out).toContain("TASK-LAG: closed git issue");
    expect(readIndex(root)["TASK-LAG"]?.status).toBe("done");
    expect(issueLines(root).find((i) => i.hash === hash)?.status).toBe("closed");
    expect(first.exit).toBe(0);

    const second = runCaptured(() => runSync(root, { fix: true }));
    expect(second.exit).toBe(0);
  });

  test("rewritten done .md + lagging index + open issue flips and closes in one pass", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-rewrite: rewritten status");
    writeTicket(root, "TASK-rewrite.md", "rewritten status", {
      status: "done",
      issue: hash,
    });
    writeIndex(root, {
      "TASK-REWRITE": indexEntry({
        extid: "TASK-REWRITE",
        hash,
        git_issue: hash,
        status: "Not Started",
        title: "rewritten status",
        source: ".plan/tickets/TASK-rewrite.md",
      }),
    });

    // The .md Status was edited to done after the index recorded Not
    // Started; the linked issue is still open. Dry-run must FLAG this
    // (not report green), and --fix converges in ONE pass: index flips
    // to done and the linked open issue is closed.
    const dry = runCaptured(() => runSync(root, {}));
    expect(dry.exit).toBe(1);
    expect(dry.out).toContain("TASK-REWRITE");

    const fixed = runCaptured(() => runSync(root, { fix: true }));
    expect(fixed.out).toContain("TASK-REWRITE: index status");
    expect(readIndex(root)["TASK-REWRITE"]?.status).toBe("done");
    expect(issueLines(root).find((i) => i.hash === hash)?.status).toBe("closed");
    expect(fixed.exit).toBe(0);

    const second = runCaptured(() => runSync(root, {}));
    expect(second.exit).toBe(0);
  });

  test("non-done vocabulary survives sync --fix when the index mirrors an open issue", () => {
    const root = makeRepo();
    const dir = join(root, ".plan/tickets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TASK-multi.md"),
      "# TASK: multi status\n\n**Status:** In Progress\n**Status**: blocked\n",
    );
    writeIndex(root, {
      "TASK-MULTI": indexEntry({
        extid: "TASK-MULTI",
        status: "open",
        title: "multi status",
        source: ".plan/tickets/TASK-multi.md",
      }),
    });

    const first = runCaptured(() => runSync(root, { fix: true }));
    // open vs In Progress/blocked: same done-ness — no drift, and the
    // binary mirror value must never leak into the .md vocabulary.
    expect(first.out).toContain("No stale .md statuses");
    const text = readFileSync(join(dir, "TASK-multi.md"), "utf8");
    expect(text).toContain("In Progress");
    expect(text).toContain("blocked");
    expect(text).not.toMatch(/\*\*Status\*\*?: open/);

    const second = runCaptured(() => runSync(root, { fix: true }));
    expect(second.exit).toBe(0);
  });

  test("index-done .md with non-done vocabulary lines rewrites every line to canonical Done", () => {
    const root = makeRepo();
    const dir = join(root, ".plan/tickets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TASK-multi.md"),
      "# TASK: multi status\n\n**Status:** In Progress\n**Status**: blocked\n",
    );
    writeIndex(root, {
      "TASK-MULTI": indexEntry({
        extid: "TASK-MULTI",
        status: "done",
        title: "multi status",
        source: ".plan/tickets/TASK-multi.md",
      }),
    });

    const first = runCaptured(() => runSync(root, { fix: true }));
    expect(first.out).toContain("TASK-MULTI: .md status in_progress → Done");
    const text = readFileSync(join(dir, "TASK-multi.md"), "utf8");
    expect((text.match(/\bDone\b/g) ?? []).length).toBe(2);
    expect(text).not.toContain("blocked");
    expect(text).not.toContain("In Progress");

    const second = runCaptured(() => runSync(root, { fix: true }));
    expect(second.exit).toBe(0);
  });

  test("In Progress ticket with an open issue survives the sync --fix ↔ plan-vocab round-trip", () => {
    // Regression for BUG-sync-fix-rewrites-md-status-to-git-issue-state:
    // sync --fix must not write the git-issue mirror value into a .md whose
    // status is a valid non-done plan-vocabulary term.
    const root = makeRepo();
    const hash = createIssue(root, "TASK-vocab: in flight");
    writeTicket(root, "TASK-vocab.md", "in flight", {
      status: "In Progress",
      issue: hash,
    });
    writeIndex(root, {
      "TASK-VOCAB": indexEntry({
        extid: "TASK-VOCAB",
        hash,
        git_issue: hash,
        status: "open",
        title: "in flight",
        source: ".plan/tickets/TASK-vocab.md",
      }),
    });

    const fixed = runCaptured(() => runSync(root, { fix: true }));
    expect(fixed.exit).toBe(0);
    const text = readFileSync(join(root, ".plan/tickets/TASK-vocab.md"), "utf8");
    expect(text).toContain("**Status:** In Progress");
    expect(text).not.toMatch(/\*\*Status\*\*?: open/);

    // Idempotent: the next pass stays green and keeps the vocabulary term.
    const again = runCaptured(() => runSync(root, { fix: true }));
    expect(again.exit).toBe(0);
    expect(readFileSync(join(root, ".plan/tickets/TASK-vocab.md"), "utf8"))
      .toContain("**Status:** In Progress");
  });

  test("phantom with a distinct non-plan source is left for manual handling", () => {
    const root = makeRepo();
    writeIndex(root, {
      "TASK-EXT": indexEntry({
        extid: "TASK-EXT",
        source: "tree/feat/TASK-EXT.md",
        status: "done",
      }),
    });

    const { out } = runCaptured(() => runSync(root, { fix: true }));

    // Never re-anchored to a guessed path, never dropped — a distinct
    // source (worktree file, external dir) is manual work.
    const idx = readIndex(root);
    expect(idx["TASK-EXT"]?.source).toBe("tree/feat/TASK-EXT.md");
    expect(out.toLowerCase()).toContain("phantom");
  });

  test("custom ticketsPath: adoption records the custom source; report agrees afterwards", () => {
    const root = makeRepo();
    writeTicket(root, "TASK-CUSTOM.md", "Custom dir work", { ticketsPath: ".plan/custom" });
    writeIndex(root, {}, ".plan/custom");

    runCaptured(() => runSync(root, { fix: true, ticketsPath: ".plan/custom" }));

    const idx = readIndex(root, ".plan/custom");
    expect(idx["TASK-CUSTOM"]?.source).toBe(".plan/custom/TASK-CUSTOM.md");

    // Report-only must agree with fix mode (same candidate dirs) — no
    // phantom churn against the just-written source.
    const report = runCaptured(() => runSync(root, { ticketsPath: ".plan/custom" }));
    expect(report.out).toContain("No phantom entries");
    expect(report.exit).toBe(0);
  });

  test("statusMismatches fix maps closed-issue git state to vocabulary Done in the .md, keeps raw done in the index", () => {
    // Regression for BUG-sync-fix-statusmismatches-branch-writes-raw-git-state:
    // the rebase scenario — issue closed in the registry without the .md
    // following — used to make the statusMismatches writer emit
    // "**Status:** done", which plan validate's status-vocab gate rejects.
    const root = makeRepo();
    const hash = createIssue(root, "TASK-MISMATCH: closed behind the .md's back");
    gitOut(root, "issue", "state", hash, "--close", "-m", "fixture close");
    writeTicket(root, "TASK-mismatch.md", "closed behind the .md's back", {
      status: "In Progress",
      issue: hash,
    });
    writeIndex(root, {
      "TASK-MISMATCH": indexEntry({
        extid: "TASK-MISMATCH",
        hash,
        git_issue: hash,
        status: "In Progress",
        title: "closed behind the .md's back",
        source: ".plan/tickets/TASK-mismatch.md",
      }),
    });

    const fixed = runCaptured(() => runSync(root, { fix: true }));
    expect(fixed.out).toContain("status in_progress → done");

    // The .md carries the canonical vocabulary term…
    const text = readFileSync(join(root, ".plan/tickets/TASK-mismatch.md"), "utf8");
    expect(text).toContain("**Status:** Done");
    expect(text).not.toMatch(/\*\*Status\*\*?: done\b/);
    // …while the index still mirrors the raw git state by design.
    expect(readIndex(root)["TASK-MISMATCH"]?.status).toBe("done");

    const second = runCaptured(() => runSync(root, { fix: true }));
    expect(second.exit).toBe(0);
  });

  test("round-trip: sync --fix after a registry-side close leaves the .md green under plan validate's status-vocab gate", () => {
    const root = makeRepo();
    const hash = createIssue(root, "TASK-ROUNDTRIP: closed out from under");
    gitOut(root, "issue", "state", hash, "--close", "-m", "fixture close");
    writeTicket(root, "TASK-roundtrip.md", "closed out from under", {
      status: "In Progress",
      issue: hash,
    });
    writeIndex(root, {
      "TASK-ROUNDTRIP": indexEntry({
        extid: "TASK-ROUNDTRIP",
        hash,
        git_issue: hash,
        status: "In Progress",
        title: "closed out from under",
        source: ".plan/tickets/TASK-roundtrip.md",
      }),
    });

    const fixed = runCaptured(() => runSync(root, { fix: true }));
    expect(fixed.exit).toBe(0);

    // No manual edit: the status-vocab gate must accept the .md as-is.
    const planDir = join(root, ".plan");
    const result = runValidate({
      projectRoot: root,
      worktreeRoot: root,
      ticketsDir: join(planDir, "tickets"),
      epicsDir: join(planDir, "epics"),
      backlogDir: join(planDir, "backlog"),
      planDir,
      srcDir: "src",
      codeMapPath: join(planDir, "code-map.json"),
      epicsIndexPath: join(planDir, "epics-index.md"),
      mapSources: [],
      linkScanDirs: [],
      backlogIndexFiles: [],
      gates: ["status-vocab"],
      runSync: () => 0,
    });
    const gate = result.results.find((r) => r.gate === "status-vocab");
    expect(gate?.pass).toBe(true);
    expect(gate?.findings).toEqual([]);
  });

  test("vocabStatusTarget resolves both git mirror states through the shared alias table", () => {
    // The statusMismatches gate only fires for done issues, so the open
    // side of the mapping is covered here: both binary states must land
    // on status-vocab-accepted terms via the same helper.
    expect(vocabStatusTarget("done")).toBe("Done");
    expect(vocabStatusTarget("open")).toBe("Not Started");
    // Freeform pass-through stays untouched (reclassify-nothing).
    expect(vocabStatusTarget("in_progress")).toBe("in_progress");
  });
});
