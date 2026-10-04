// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { task, TASK_USAGE } from "./task";
import { directiveSlug, isGateCsv, parseTaskArgs, TaskArgError } from "./task/args";

interface Captured {
  out: string;
  err: string;
}

function capture(): Captured & { restore: () => void; } {
  const chunks: string[] = [];
  const errChunks: string[] = [];
  const outSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  const errSpy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errChunks.push(String(chunk));
    return true;
  });
  return {
    get out(): string {
      return chunks.join("");
    },
    get err(): string {
      return errChunks.join("");
    },
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

/** Minimal config stand-in: the task handler never touches git/config. */
const stubConfig = {} as Parameters<typeof task>[1];

describe("parseTaskArgs", () => {
  it("accepts every -m/-d/--message/--directive alias", () => {
    for (const alias of ["-m", "-d", "--message", "--directive"]) {
      expect(parseTaskArgs([alias, "fix the bug"]).directive).toBe("fix the bug");
    }
  });

  it("joins positional tokens into the directive and trims", () => {
    expect(parseTaskArgs(["fix", "login", "race"]).directive).toBe("fix login race");
  });

  it("splits --flag=value inline forms", () => {
    const flags = parseTaskArgs(["--jobs=3", "--agents=-1"]);
    expect(flags.jobs).toBe(3);
    expect(flags.agents).toBe(-1);
    expect(parseTaskArgs(["--skills=min"]).skills).toBe("min");
  });

  it("rejects positional text together with -m or -F", () => {
    expect(() => parseTaskArgs(["text", "-m", "msg"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["-F", "f.txt", "text"])).toThrow(TaskArgError);
  });

  it("rejects -m together with -F", () => {
    expect(() => parseTaskArgs(["-m", "msg", "-F", "f.txt"])).toThrow(TaskArgError);
  });

  it("rejects --shallow with --deep and --strict with -g in any order", () => {
    expect(() => parseTaskArgs(["--shallow", "--deep"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["--strict", "-g", "lint"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["-g", "lint", "--strict"])).toThrow(TaskArgError);
  });

  it("rejects --good/--fast alongside -a 0", () => {
    expect(() => parseTaskArgs(["-a", "0", "--good", "2"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["--fast", "1", "-a", "0"])).toThrow(TaskArgError);
    expect(parseTaskArgs(["-a", "2", "--good", "1"]).good).toBe(1);
  });

  it("validates integer ranges: jobs >= 0, agents >= -1, skills enum", () => {
    expect(() => parseTaskArgs(["-j", "-1"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["-j", "x"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["-a", "-2"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["-a", "1.5"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["-s", "bogus"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["-m"])).toThrow(/missing value/);
    expect(parseTaskArgs(["-a", "-1"]).agents).toBe(-1);
    expect(parseTaskArgs(["-j", "0"]).jobs).toBe(0);
  });

  it("treats bare -w as slug-derivation and -w name as explicit", () => {
    expect(parseTaskArgs(["-w"]).worktree).toBe(true);
    expect(parseTaskArgs(["--worktree", "fix-login"]).worktree).toBe("fix-login");
    expect(parseTaskArgs(["--worktree=fix-login"]).worktree).toBe("fix-login");
    // empty =-value falls back to slug derivation, never a blank name
    expect(parseTaskArgs(["--worktree="]).worktree).toBe(true);
    // a following flag is not swallowed as the worktree name
    expect(parseTaskArgs(["-w", "--deep"]).worktree).toBe(true);
    expect(parseTaskArgs(["-w", "--deep"]).depth).toBe("deep");
  });

  it("implies worktree via --base/--tickets and splits csv tickets", () => {
    const flags = parseTaskArgs(["--base", "main", "--tickets", "FEAT-1, FIX-2"]);
    expect(flags.base).toBe("main");
    expect(flags.tickets).toEqual(["FEAT-1", "FIX-2"]);
  });

  it("collects repeatable follow/careful/docs lines", () => {
    const flags = parseTaskArgs([
      "--follow",
      "repo conventions",
      "--careful",
      "lock ordering",
      "--docs",
      "AGENTS.md",
    ]);
    expect(flags.follow).toEqual(["repo conventions"]);
    expect(flags.careful).toEqual(["lock ordering"]);
    expect(flags.docs).toEqual(["AGENTS.md"]);
  });

  it("treats everything after -- as positional directive", () => {
    expect(parseTaskArgs(["--", "-w", "not-a-flag"]).directive).toBe("-w not-a-flag");
  });

  it("classifies gate csv vs prose", () => {
    expect(isGateCsv("lint,format")).toBe(true);
    expect(isGateCsv("only check related gates on finalization")).toBe(false);
    expect(parseTaskArgs(["-g", "lint,format"]).gates).toBe("lint,format");
  });

  it("accepts --roster and rejects it with task text", () => {
    expect(parseTaskArgs(["--roster"]).roster).toBe(true);
    expect(() => parseTaskArgs(["--roster", "-m", "x"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["--roster", "fix", "it"])).toThrow(TaskArgError);
    expect(() => parseTaskArgs(["--roster", "-F", "f.txt"])).toThrow(TaskArgError);
  });

  it("derives kebab slugs capped at 40 chars", () => {
    expect(directiveSlug("Fix the Login Race! (v2)")).toBe("fix-the-login-race-v2");
    expect(directiveSlug("!!!")).toBe("");
    expect(directiveSlug("x".repeat(80)).length).toBe(40);
  });
});

describe("task handler output", () => {
  it("renders guidance sections with the directive last", async () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    await task(["add retry logic", "-a", "3", "--deep"], stubConfig);
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    expect(out).toContain("# Task");
    expect(out).toContain("- Subagents: prefer up to 3");
    expect(out).toContain("- Research: study repository state first");
    expect(out).toContain("do not read additional skills");
    expect(out).toContain("- Gates: on finalization run the gates related");
    expect(out).toContain("## Directive (user - authoritative)");
    expect(out.trimEnd().endsWith("add retry logic")).toBe(true);
  });

  it("suppresses finalization for -j 0 and names --jobs otherwise", async () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    await task(["t1", "-j", "0"], stubConfig);
    const noFinalize = spy.mock.calls.map((c) => String(c[0])).join("");
    await task(["t2", "-j", "4"], stubConfig);
    const jobsOut = spy.mock.calls.map((c) => String(c[0])).join("").slice(noFinalize.length);
    spy.mockRestore();
    expect(noFinalize).toContain("Do not finalize changes");
    expect(noFinalize).not.toContain("giwt finalize <branch>` (gates");
    expect(jobsOut).toContain("--jobs 4");
  });

  it("embeds gates all/csv/prose forms and worktree slug", async () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    await task(["Refactor Auth Flow!", "-g", "all", "-w"], stubConfig);
    const all = spy.mock.calls.map((c) => String(c[0])).join("");
    await task(["x2", "-g", "lint,format", "--follow", "existing handler style"], stubConfig);
    const csv = spy.mock.calls.map((c) => String(c[0])).join("").slice(all.length);
    spy.mockRestore();
    expect(all).toContain("ignore all gates - urgent merge, minimal testing");
    expect(all).toContain("giwt new refactor-auth-flow");
    expect(csv).toContain("--skip-gates lint,format");
    expect(csv).toContain("Follow patterns: existing handler style");
  });

  it("covers every guidance branch mode", async () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    const cases: string[][] = [
      ["a0", "-a", "0"],
      ["amax", "-a", "-1"],
      ["asplit", "--good", "2", "--fast", "3"],
      ["gnone", "-g", "none"],
      ["gprose", "-g", "only check related gates on finalization"],
      ["gstrict", "--strict"],
      ["smin", "-s", "min"],
      ["smax", "-s", "max"],
      ["sreasonable", "-s", "reasonable"],
      ["shallow", "--shallow"],
      ["wt full", "--worktree", "named-wt", "--base", "main", "--tickets", "T-1,T-2"],
    ];
    const outs: string[] = [];
    for (const args of cases) {
      const before = spy.mock.calls.length;
      await task(args, stubConfig);
      outs.push(
        spy.mock.calls
          .slice(before)
          .map((c) => String(c[0]))
          .join(""),
      );
    }
    spy.mockRestore();
    const [a0, amax, asplit, gnone, gprose, gstrict, smin, smax, sreasonable, shallow, wtFull] =
      outs;
    expect(a0).toContain("do not use any subagents");
    expect(amax).toContain("as many as possible until the rate limit");
    expect(asplit).toContain("2 good (complex), 3 fast (mechanical)");
    expect(gnone).toContain("do not skip any gates");
    expect(gprose).toContain("- Gates: only check related gates on finalization");
    expect(gstrict).toContain("full gate suite");
    expect(smin).toContain("avoid advertised/suggested skills");
    expect(smax).toContain("read the relevant project docs and advertised skills");
    expect(sreasonable).toContain("directly relevant to this task");
    expect(shallow).toContain("jump straight in");
    expect(wtFull).toContain("giwt new named-wt main");
    expect(wtFull).toContain("--tickets T-1,T-2");
  });

  it("accepts a lone dash as positional text", () => {
    expect(parseTaskArgs(["-"]).directive).toBe("-");
  });

  // Dispatch-level stdin coverage (-F '-'): runs the real CLI as a
  // subprocess (sync.test.ts convention — no mock.module). Resource
  // contract (parallel-safe): unique mkdtemp git repo per test, torn
  // down in finally; spawn is bounded by a 30s spawn timeout.
  it("reads the directive from -F - via dispatch (stdin subprocess)", async () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-task-stdin-"));
    try {
      const gitEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith("GIT_") || key === "GNUPGHOME") continue;
        if (value !== undefined) gitEnv[key] = value;
      }
      const init = Bun.spawnSync(["git", "-C", root, "init", "-q"], {
        stdout: "ignore",
        stderr: "ignore",
        env: gitEnv,
      });
      expect(init.exitCode).toBe(0);
      mkdirSync(join(root, "tree"));
      const proc = Bun.spawn(
        [process.execPath, join(import.meta.dir, "..", "cli.ts"), "task", "-F", "-"],
        {
          cwd: root,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          env: gitEnv,
          timeout: 30_000,
        },
      );
      proc.stdin.write("piped directive\n");
      proc.stdin.end();
      const [out, code] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);
      expect(code).toBe(0);
      expect(out).toContain("# Task");
      expect(out.trimEnd().endsWith("piped directive")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the directive from -F file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "giwt-task-"));
    try {
      const file = join(dir, "directive.txt");
      writeFileSync(file, "ship the thing\n");
      const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
      await task(["-F", file], stubConfig);
      const out = spy.mock.calls.map((c) => String(c[0])).join("");
      spy.mockRestore();
      expect(out).toContain("ship the thing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--roster prints a parseable JSON array of open-work entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-task-roster-"));
    try {
      mkdirSync(join(root, ".plan", "tickets"), { recursive: true });
      writeFileSync(
        join(root, ".plan", "tickets", "TASK-alpha.md"),
        "# TASK: alpha work\n\n**Status:** open\n",
      );
      writeFileSync(
        join(root, ".plan", "tickets", "BUG-done.md"),
        "# BUG: finished work\n\n**Status:** Done\n",
      );
      const rosterConfig = {
        worktreeRoot: root,
        settings: { paths: { tickets: ".plan/tickets" } },
      } as unknown as Parameters<typeof task>[1];
      const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
      await task(["--roster"], rosterConfig);
      const out = spy.mock.calls.map((c) => String(c[0])).join("");
      spy.mockRestore();
      const roster = JSON.parse(out) as Array<{ id: string; title: string; source: string; }>;
      expect(Array.isArray(roster)).toBe(true);
      expect(roster).toHaveLength(1);
      expect(roster[0]).toMatchObject({ id: "TASK-alpha", title: "alpha work", source: "plan" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints usage and exits 1 on parse errors and missing text", async () => {
    const capturedErr = capture();
    const exits: number[] = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        exits.push(code ?? 0);
        throw new Error(`__exit:${code}`);
      }) as typeof process.exit,
    );
    try {
      await expect(task(["--bogus"], stubConfig)).rejects.toThrow("__exit:1");
      await expect(task([], stubConfig)).rejects.toThrow("__exit:1");
    } finally {
      exitSpy.mockRestore();
      capturedErr.restore();
    }
    expect(exits).toEqual([1, 1]);
    expect(TASK_USAGE).toContain("--gates");
    expect(TASK_USAGE).toContain("--roster");
  });
});
