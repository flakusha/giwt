// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for scoped worktree creation (`giwt new --scope --tickets`,
 * FEAT-scoped-worktree-creation-new-scope-and-tickets-flags).
 *
 * Real git fixtures, no mock.module (repo convention). Each test owns a
 * mkdtemp repo torn down in afterEach. Covers:
 *   - create with --scope/--tickets: worktree copy has In Progress + Scope
 *     header, master copy untouched, first commit landed, marker written
 *   - unknown ticket id refuses BEFORE any git mutation
 *   - empty --tickets csv refuses
 *   - marker round-trip + Step 5.5 reconcile helper (regen + commit skip)
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute as createWorktree } from "./create";
import { extidForHash, extractExtid, resolveExtid } from "./resolver";
import {
  applyScopedTickets,
  closeScopedIssues,
  parseScopeFlags,
  readScopedMeta,
  reconcilePlanPostMerge,
  resolveScopedTickets,
  scopedSignFlags,
} from "./scoped-worktree";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString();
}

function makeRepo(slug: string): WorktreeConfig {
  const root = mkdtempSync(join(tmpdir(), `giwt-scoped-${slug}-`));
  tempRoots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "giwt-test@localhost");
  git(root, "config", "user.name", "giwt test");
  git(root, "config", "commit.gpgsign", "false");
  const ticketsDir = join(root, ".plan", "tickets");
  mkdirSync(ticketsDir, { recursive: true });
  writeFileSync(
    join(ticketsDir, "FEAT-demo-ticket.md"),
    "# FEAT: demo ticket\n\n**Status:** Not Started\n**Priority:** medium\n\nBody.\n",
  );
  writeFileSync(join(ticketsDir, "index.json"), "{}\n");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "seed");
  git(root, "branch", "feature-x");
  return {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
}

let origExit: typeof process.exit | undefined;

function exitSpy(exits: number[]): void {
  origExit = process.exit;
  process.exit = ((code?: number): never => {
    exits.push(code ?? 0);
    throw new Error(`__exit:${code ?? 0}`);
  }) as never;
}

function restoreExit(): void {
  if (origExit) process.exit = origExit;
}

describe("scoped worktree creation", () => {
  test("create copies tickets as In Progress + Scope, master untouched, first commit landed", async () => {
    const cfg = makeRepo("create");
    const exits: number[] = [];
    exitSpy(exits);
    try {
      await createWorktree(
        ["feature-x", "--scope", "demo scope", "--tickets", "FEAT-demo-ticket"],
        cfg,
      );
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    expect(exits).toEqual([]);

    const wtPath = join(cfg.treeDir, "feature-x");
    expect(existsSync(wtPath)).toBe(true);

    const wtTicket = readFileSync(join(wtPath, ".plan", "tickets", "FEAT-demo-ticket.md"), "utf8");
    expect(wtTicket).toContain("**Status:** In Progress");
    expect(wtTicket).toContain("**Scope:** demo scope");

    const masterTicket = readFileSync(
      join(cfg.repoRoot, ".plan", "tickets", "FEAT-demo-ticket.md"),
      "utf8",
    );
    expect(masterTicket).toContain("**Status:** Not Started");
    expect(masterTicket).not.toContain("**Scope:**");

    const log = git(wtPath, "log", "--oneline");
    expect(log).toContain("scope 1 ticket(s)");

    const meta = readScopedMeta(wtPath);
    expect(meta?.tickets).toEqual(["FEAT-DEMO-TICKET"]);
    expect(meta?.scope).toBe("demo scope");
  });

  test("unknown ticket id refuses before any git mutation", () => {
    const cfg = makeRepo("unknown");
    const exits: number[] = [];
    exitSpy(exits);
    try {
      resolveScopedTickets(cfg, ["TASK-does-not-exist"]);
      throw new Error("should have exited");
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    expect(exits).toEqual([1]);
    expect(existsSync(join(cfg.treeDir, "feature-x"))).toBe(false);
  });

  test("empty --tickets csv refuses", () => {
    const exits: number[] = [];
    exitSpy(exits);
    try {
      parseScopeFlags(["feature-x", "--tickets", ",,"]);
      throw new Error("should have exited");
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    expect(exits).toEqual([1]);
  });

  test("scopedSignFlags mirrors agent key presence", () => {
    expect(scopedSignFlags(undefined)).toEqual([]);
    expect(scopedSignFlags("0123456789ABCDEF")).toEqual([
      "-c",
      "commit.gpgsign=true",
      "-c",
      "user.signingkey=0123456789ABCDEF",
    ]);
  });

  test("--tickets and --scope without values refuse", () => {
    const exits: number[] = [];
    for (const args of [["feature-x", "--tickets"], ["feature-x", "--scope", "--tickets"]]) {
      exitSpy(exits);
      try {
        parseScopeFlags(args);
        throw new Error("should have exited");
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
      } finally {
        restoreExit();
      }
    }
    expect(exits).toEqual([1, 1]);
  });

  test("marker round-trips and Step 5.5 reconcile skips when plan state consistent", async () => {
    const cfg = makeRepo("reconcile");
    const exits: number[] = [];
    exitSpy(exits);
    try {
      await createWorktree(["feature-x"], cfg);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    expect(exits).toEqual([]);
    const wtPath = join(cfg.treeDir, "feature-x");
    expect(existsSync(wtPath)).toBe(true);

    applyScopedTickets(cfg, wtPath, undefined, ["feat-demo-ticket.md"]);
    const meta = readScopedMeta(wtPath);
    expect(meta?.tickets).toEqual(["FEAT-DEMO-TICKET"]);

    // Make master plan state fully consistent: matching index entry, matching
    // status — runSync --fix must apply zero fixes so the reconcile takes the
    // idempotent no-commit path.
    writeFileSync(
      join(cfg.repoRoot, ".plan", "tickets", "index.json"),
      `${
        JSON.stringify(
          {
            "FEAT-DEMO-TICKET": {
              hash: "pending",
              extid: "FEAT-DEMO-TICKET",
              type: "FEAT",
              title: "demo ticket",
              status: "open",
              source: ".plan/tickets/FEAT-demo-ticket.md",
            },
          },
          null,
          2,
        )
      }\n`,
    );
    git(cfg.repoRoot, "add", "-f", ".plan");
    git(cfg.repoRoot, "commit", "-q", "-m", "seed plan state");

    // Plan state is consistent (master index empty but no contradictions
    // runSync can fix without a registry) — reconcile must not throw and
    // must report the no-commit path.
    const logs: string[] = [];
    const spy = spyOn(process.stdout, "write").mockImplementation(
      ((c: unknown) => (logs.push(String(c)), true)) as never,
    );
    try {
      reconcilePlanPostMerge(cfg);
    } finally {
      spy.mockRestore();
    }
    expect(logs.join("")).toContain("no commit");
  });

  test("corrupt scope marker reads as null", async () => {
    const cfg = makeRepo("corrupt");
    const exits: number[] = [];
    exitSpy(exits);
    try {
      await createWorktree(["feature-x"], cfg);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    const wtPath = join(cfg.treeDir, "feature-x");
    const gitDir = git(wtPath, "rev-parse", "--git-dir").trim();
    writeFileSync(join(gitDir, "giwt-scoped.json"), "not json{");
    expect(readScopedMeta(wtPath)).toBeNull();
  });

  test("parseScopeFlags rejects missing values and unknown flags", () => {
    const exits: number[] = [];
    exitSpy(exits);
    try {
      parseScopeFlags(["feature-x", "--scope"]);
      throw new Error("should have exited");
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    expect(exits).toEqual([1]);

    exitSpy(exits);
    try {
      parseScopeFlags(["feature-x", "--frobnicate"]);
      throw new Error("should have exited");
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    expect(exits).toEqual([1, 1]);
  });

  test("closeScopedIssues closes a real registry issue", () => {
    const cfg = makeRepo("close-real");
    const created = Bun.spawnSync(
      ["git", "-C", cfg.repoRoot, "issue", "create", "FEAT-DEMO-TICKET: demo ticket", "-m", "body"],
      { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
    );
    if (created.exitCode !== 0) {
      console.warn("git-issue unavailable — skipping close-success case");
      return;
    }
    const errs: string[] = [];
    const outSpy = spyOn(process.stdout, "write").mockImplementation(
      ((c: unknown) => (errs.push(String(c)), true)) as never,
    );
    const errSpy = spyOn(process.stderr, "write").mockImplementation(
      ((c: unknown) => (errs.push(String(c)), true)) as never,
    );
    try {
      closeScopedIssues(cfg.repoRoot, ["FEAT-DEMO-TICKET"]);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(errs.join("")).toContain("closed FEAT-DEMO-TICKET");
  });

  test("re-closing an already-closed issue stays idempotent", () => {
    const cfg = makeRepo("close-done");
    const created = Bun.spawnSync(
      ["git", "-C", cfg.repoRoot, "issue", "create", "FEAT-DEMO-TICKET: demo ticket", "-m", "body"],
      { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
    );
    if (created.exitCode !== 0) {
      console.warn("git-issue unavailable — skipping already-closed case");
      return;
    }
    const hash = created.stdout.toString().match(/[0-9a-f]{7,40}/)?.[0] ?? "";
    git(cfg.repoRoot, "issue", "state", hash, "--close");
    const errs: string[] = [];
    const outSpy = spyOn(process.stdout, "write").mockImplementation(
      ((c: unknown) => (errs.push(String(c)), true)) as never,
    );
    const errSpy = spyOn(process.stderr, "write").mockImplementation(
      ((c: unknown) => (errs.push(String(c)), true)) as never,
    );
    try {
      closeScopedIssues(cfg.repoRoot, ["FEAT-DEMO-TICKET"]);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(errs.join("")).toContain("closed FEAT-DEMO-TICKET");
  });

  test("resolveExtid null paths: foreign titles and unknown slugs", () => {
    const cfg = makeRepo("resolver-null");
    expect(extractExtid("no extid prefix here")).toBeNull();
    expect(resolveExtid(cfg.repoRoot, "TASK-never-filed-anywhere")).toBeNull();
  });

  test("closeScopedIssues tolerates a failing registry", () => {
    const cfg = makeRepo("close");
    const logs: string[] = [];
    const errs: string[] = [];
    const outSpy = spyOn(process.stdout, "write").mockImplementation(
      ((c: unknown) => (logs.push(String(c)), true)) as never,
    );
    const errSpy = spyOn(process.stderr, "write").mockImplementation(
      ((c: unknown) => (errs.push(String(c)), true)) as never,
    );
    try {
      closeScopedIssues(cfg.repoRoot, ["FEAT-DEMO-TICKET"]);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    // No git-issue registry in the fixture: resolveExtid finds nothing, the
    // close degrades to a warn (stderr), never throws — best-effort.
    expect(errs.join("")).toContain("could not resolve FEAT-DEMO-TICKET");
  });

  test("Step 5.5 reconcile commits when sync --fix lands changes", () => {
    const cfg = makeRepo("reconcile-commit");
    // Index-done ticket whose .md still says Not Started (no registry in the
    // fixture): runSync --fix rewrites the .md to the canonical Done — a real
    // plan change the reconcile commit must pick up.
    const idx = {
      "FEAT-DEMO-TICKET": {
        hash: "pending",
        extid: "FEAT-DEMO-TICKET",
        type: "FEAT",
        title: "demo ticket",
        status: "done",
        source: ".plan/tickets/FEAT-demo-ticket.md",
      },
      "TASK-ADOPT-ME": {
        hash: "pending",
        extid: "TASK-ADOPT-ME",
        type: "TASK",
        title: "adopt me",
        status: "done",
        source: ".plan/tickets/TASK-adopt-me.md",
      },
    };
    writeFileSync(
      join(cfg.repoRoot, ".plan", "tickets", "TASK-adopt-me.md"),
      "# TASK: adopt me\n\n**Status:** Not Started\n**Priority:** medium\n\nBody.\n",
    );
    writeFileSync(
      join(cfg.repoRoot, ".plan", "tickets", "index.json"),
      `${JSON.stringify(idx, null, 2)}\n`,
    );
    writeFileSync(join(cfg.repoRoot, ".plan", "feature-matrix.md"), "STALE\n");
    writeFileSync(join(cfg.repoRoot, ".plan", "code-map.json"), "{}\n");

    const logs: string[] = [];
    const spy = spyOn(process.stdout, "write").mockImplementation(
      ((c: unknown) => (logs.push(String(c)), true)) as never,
    );
    try {
      reconcilePlanPostMerge(cfg);
    } finally {
      spy.mockRestore();
    }
    expect(logs.join("")).toContain("plan reconciliation committed");
    const log = git(cfg.repoRoot, "log", "--oneline", "-1");
    expect(log).toContain("post-merge reconciliation");
    // Generated artifacts were regenerated as part of the same pass.
    expect(readFileSync(join(cfg.repoRoot, ".plan", "feature-matrix.md"), "utf8"))
      .not.toContain("STALE");
  });
});

describe.skipIf(Bun.which("git-issue") === null)("scoped ticket id — hash form", () => {
  test("resolves a raw git-issue hash to the ticket file", () => {
    const cfg = makeRepo("hash");
    git(cfg.repoRoot, "issue", "create", "FEAT-demo-ticket: demo ticket", "-m", "body");
    const line = git(cfg.repoRoot, "issue", "ls", "--all", "--format", "oneline")
      .split("\n")
      .find((l) => l.includes("FEAT-demo-ticket"));
    if (!line) throw new Error("fixture: no issue created");
    const hash = line.split(" ")[0]!;

    const scoped = resolveScopedTickets(cfg, [hash.slice(0, 7)]);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.extid).toBe("FEAT-DEMO-TICKET");
    expect(scoped[0]!.filename).toBe("FEAT-demo-ticket.md");
  });

  test("still refuses an unknown hash before any git mutation", () => {
    const cfg = makeRepo("hash-unknown");
    const exits: number[] = [];
    exitSpy(exits);
    try {
      resolveScopedTickets(cfg, ["deadbee"]);
      throw new Error("should have exited");
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("__exit:")) throw e;
    } finally {
      restoreExit();
    }
    expect(exits).toEqual([1]);
  });
});

describe("extidForHash", () => {
  test("returns null for non-hex input without touching the registry", () => {
    expect(extidForHash("/nonexistent-repo", "TASK-not-a-hash")).toBeNull();
  });
});

describe("resolveExtid hash passthrough", () => {
  test("strips a pasted .md suffix from the hash passthrough", () => {
    const resolved = resolveExtid("/nonexistent-repo", "40464b1.md");
    expect(resolved?.hash).toBe("40464b1");
    expect(resolved?.raw).toBe("40464b1.md");
  });
});
