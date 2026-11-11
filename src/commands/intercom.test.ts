// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt intercom` end-to-end (subprocess, plan.test.ts conventions — no
 * mock.module, so the command module never loads in the coverage process):
 *
 * - init → store + `.tmp/intercom` link + outcome line; idempotent re-init
 * - claim → claim file + claim event + ledger record; double claim fails
 *   (exit 1, fail outcome line, no second claim file)
 * - done → FIXED stub + done event + ledger record
 * - ls → derived board (--json round-trip); read → event tail + envelope
 *   shape + malformed count
 * - gc [--apply] → dry-run plan line, apply moves/stamps/compacts
 * - ledger silence: init/ls/read/gc leave no ledger record
 * - worktrees share the store (identity = common dir)
 * - doctor check --checks intercom --json registers and reports
 * - `giwt clean` never touches the store through the `.tmp/intercom` link
 * - before init: claim/ls/gc fail with the init remedy
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";

const tempRoots: string[] = [];
const CLI = join(import.meta.dir, "..", "cli.ts");

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-intercom-cmd-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"]);
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"]);
  execFileSync("git", ["-C", root, "commit", "--allow-empty", "-qm", "seed"]);
  return root;
}

type Captured = { out: string; err: string; code: number; };

function run(args: string[], root: string, extraEnv: Record<string, string> = {}): Captured {
  const stateDir = join(root, "state");
  mkdirSync(stateDir, { recursive: true });
  const proc = Bun.spawnSync(["bun", CLI, "intercom", ...args], {
    cwd: root,
    env: {
      ...isolatedGitEnv(),
      REPO_ROOT: root,
      TREE_DIR: root,
      GIWT_INTERCOM_STATE_DIR: stateDir,
      GIWT_AGENT: "test-agent",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  return {
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
    code: proc.exitCode ?? 1,
  };
}

function storeDir(root: string): string {
  const name = readdirSync(join(root, "state"))[0];
  if (name === undefined) return "";
  return join(root, "state", name);
}

function ledgerLines(root: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(join(root, ".ledger.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe("giwt intercom end-to-end", () => {
  it("init creates the store + link with an outcome line; re-init is a no-op", () => {
    const root = makeRoot();
    const first = run(["init"], root);
    expect(first.code).toBe(0);
    expect(first.out).toContain("store: ");
    expect(first.out).toMatch(/ok intercom created \S+ · run \w/);
    expect(first.out).toContain("backend: jsonl");
    const link = `${root}/.tmp/intercom`;
    expect(existsSync(link)).toBe(true);
    const second = run(["init"], root);
    expect(second.code).toBe(0);
    expect(second.out).toContain("verified");
    // No ledger record for init (family is ledger-silent; init self-manages
    // a run record only).
    expect(ledgerLines(root)).toEqual([]);
  });

  it("claim then double-claim fails loudly with the existing owner named", () => {
    const root = makeRoot();
    run(["init"], root);
    const claim = run(["claim", "lane-a", "--owner", "agent-1", "--scope", "prep"], root);
    expect(claim.code).toBe(0);
    expect(claim.out).toMatch(/ok intercom claimed lane-a \(owner agent-1\) · run/);
    const store = storeDir(root);
    expect(existsSync(join(store, "LANE-lane-a.md"))).toBe(true);
    const events = readFileSync(join(store, "events.jsonl"), "utf8").trim().split("\n").map((l) =>
      JSON.parse(l) as Record<string, unknown>
    );
    expect(events[0]).toMatchObject({
      v: 1,
      type: "claim",
      lane: "lane-a",
      actor: "agent-1",
      refs: [],
      body: "prep",
    });
    expect(typeof events[0]?.seq).toBe("number");
    const ledger = ledgerLines(root);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ cmd: "intercom", state: "finished" });
    expect(ledger[0]?.msg).toBe("intercom claim :: ok");
    // Double claim: exit 1, fail outcome, owner named, ledger line terminal.
    const again = run(["claim", "lane-a", "--owner", "agent-2"], root);
    expect(again.code).toBe(1);
    expect(again.out).toContain("fail intercom");
    expect(again.err).toContain("already claimed");
    expect(again.err).toContain("agent-1");
    expect(ledgerLines(root)).toHaveLength(2);
    expect(ledgerLines(root)[1]).toMatchObject({ cmd: "intercom", state: "postponed" });
  });

  it("actor stamps from GIWT_AGENT when --owner is absent", () => {
    const root = makeRoot();
    run(["init"], root);
    const claim = run(["claim", "lane-x"], root);
    expect(claim.code).toBe(0);
    expect(claim.out).toContain("owner test-agent");
  });

  it("done records completion, pairing with the claim; orphan done works too", () => {
    const root = makeRoot();
    run(["init"], root);
    run(["claim", "lane-a", "--owner", "agent-1"], root);
    const done = run(["done", "lane-a", "--note", "landed 81d6ce4"], root);
    expect(done.code).toBe(0);
    expect(done.out).toMatch(/ok intercom done lane-a · run/);
    const store = storeDir(root);
    // The FIXED stub's owner is the DONE caller's identity (GIWT_AGENT here),
    // not the claim's owner — completion is stamped by who closed it.
    const fixed = readFileSync(join(store, "FIXED-lane-a.md"), "utf8");
    expect(fixed).toContain("owner=test-agent");
    expect(fixed).toContain("landed 81d6ce4");
    const orphan = run(["done", "no-such-lane"], root);
    expect(orphan.code).toBe(0);
    expect(orphan.out).toContain("no claim file");
    expect(ledgerLines(root).filter((l) => l.cmd === "intercom")).toHaveLength(3);
  });

  it("ls prints the derived board; --json round-trips", () => {
    const root = makeRoot();
    run(["init"], root);
    run(["claim", "lane-a", "--owner", "agent-1"], root);
    run(["done", "lane-a"], root);
    run(["claim", "lane-b", "--owner", "agent-2"], root);
    const ls = run(["ls"], root);
    expect(ls.code).toBe(0);
    expect(ls.out).toContain("WHO-DOES-WHAT");
    expect(ls.out).toContain("lane-a  agent-1");
    expect(ls.out).toContain("lane-b  agent-2");
    expect(ls.out).toContain("2 lane(s): 1 done, 1 active, 0 stale");
    const json = run(["ls", "--json"], root);
    const payload = JSON.parse(json.out) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ lane: "lane-a", status: "done", owner: "agent-1" });
    // Readers are ledger-silent.
    expect(ledgerLines(root).filter((l) => l.msg !== undefined && (l.msg as string).includes("ls")))
      .toEqual([]);
  });

  it("read dumps the event tail and counts malformed lines", () => {
    const root = makeRoot();
    run(["init"], root);
    run(["claim", "lane-a", "--owner", "a"], root);
    run(["done", "lane-a", "--note", "ok"], root);
    const read = run(["read", "--last", "10"], root);
    expect(read.code).toBe(0);
    expect(read.out).toContain("claim lane-a");
    expect(read.out).toContain("done  lane-a");
    const json = JSON.parse(run(["read", "--json"], root).out) as {
      events: Array<Record<string, unknown>>;
      malformed: number;
    };
    expect(json.events).toHaveLength(2);
    expect(json.malformed).toBe(0);
    // Torn tail is skipped and counted.
    const store = storeDir(root);
    appendFileSync(join(store, "events.jsonl"), "{torn");
    const after = JSON.parse(run(["read", "--json"], root).out) as { malformed: number; };
    expect(after.malformed).toBe(1);
  });

  it("gc is dry-run by default and --apply archives/stamps/compacts", () => {
    const root = makeRoot();
    run(["init"], root);
    const store = storeDir(root);
    writeFileSync(join(store, "FIXED-old.md"), "# FIXED: old\n");
    const past = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    utimesSync(join(store, "FIXED-old.md"), past, past);
    const dry = run(["gc"], root);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would archive: FIXED-old.md");
    expect(existsSync(join(store, "FIXED-old.md"))).toBe(true);
    const applied = run(["gc", "--apply"], root);
    expect(applied.code).toBe(0);
    expect(applied.out).toMatch(/ok intercom applied: 1 archived.* · run/);
    expect(existsSync(join(store, "archive", "FIXED-old.md"))).toBe(true);
    expect(existsSync(join(store, "FIXED-old.md"))).toBe(false);
  });

  it("fails with the init remedy before the store exists", () => {
    const root = makeRoot();
    const claim = run(["claim", "lane-a"], root);
    expect(claim.code).toBe(1);
    expect(claim.err).toContain("giwt intercom init");
    expect(run(["ls"], root).code).toBe(1);
    expect(run(["gc", "--apply"], root).code).toBe(1);
  });

  it("worktrees share one store with the root checkout", () => {
    const root = makeRoot();
    run(["init"], root);
    const wt = join(root, "tree", "lane-wt");
    execFileSync("git", ["-C", root, "worktree", "add", "-q", wt, "-b", "lane-wt"], {
      env: isolatedGitEnv(),
    });
    tempRoots.push(wt);
    // NO REPO_ROOT/TREE_DIR: the real worktree invocation resolves its own
    // checkout (findRepoRoot → --git-common-dir), keying the SAME store.
    const wtEnv = {
      ...isolatedGitEnv(),
      GIWT_INTERCOM_STATE_DIR: join(root, "state"),
      GIWT_AGENT: "wt-lane",
    };
    const wtInit = Bun.spawnSync(["bun", CLI, "intercom", "init"], {
      cwd: wt,
      env: wtEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    expect(wtInit.exitCode).toBe(0);
    expect(existsSync(join(wt, ".tmp", "intercom"))).toBe(true);
    const claim = Bun.spawnSync(
      ["bun", CLI, "intercom", "claim", "from-wt", "--owner", "wt-lane"],
      {
        cwd: wt,
        env: wtEnv,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60000,
      },
    );
    expect(claim.exitCode).toBe(0);
    const store = storeDir(root);
    expect(existsSync(join(store, "LANE-from-wt.md"))).toBe(true);
  });

  it("doctor check --checks intercom reports the store health as JSON", () => {
    const root = makeRoot();
    run(["init"], root);
    const proc = Bun.spawnSync(["bun", CLI, "doctor", "check", "--checks", "intercom", "--json"], {
      cwd: root,
      env: {
        ...isolatedGitEnv(),
        REPO_ROOT: root,
        TREE_DIR: root,
        GIWT_INTERCOM_STATE_DIR: join(root, "state"),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    expect(proc.exitCode).toBe(0);
    const text = proc.stdout.toString();
    const report = JSON.parse(text.slice(text.indexOf("{"))) as {
      checks: Array<{ id: string; ok: boolean; notes?: string[]; }>;
    };
    const check = report.checks.find((c) => c.id === "intercom")!;
    expect(check.ok).toBe(true);
    expect(check.notes?.some((n) => n.includes("store:"))).toBe(true);
  });

  it("clean never touches the store contents through the .tmp/intercom link", () => {
    const root = makeRoot();
    run(["init"], root);
    const store = storeDir(root);
    // A deletable class lives INSIDE the store target: an aged orphan *.tmp.
    const victim = join(store, "orphan.tmp");
    writeFileSync(victim, "coordination evidence");
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(victim, past, past);
    // init already created the symlink; assert the precondition so this
    // invariant means what it says (a link, not a real dir).
    expect(lstatSync(join(root, ".tmp", "intercom")).isSymbolicLink()).toBe(true);
    const clean = Bun.spawnSync(["bun", CLI, "clean", "--apply"], {
      cwd: root,
      env: {
        ...isolatedGitEnv(),
        REPO_ROOT: root,
        TREE_DIR: root,
        GIWT_INTERCOM_STATE_DIR: join(root, "state"),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    expect(clean.exitCode).toBe(0);
    expect(existsSync(victim)).toBe(true);
    expect(readFileSync(victim, "utf8")).toBe("coordination evidence");
    expect(clean.stdout.toString()).not.toContain("orphan.tmp");
  });
});
