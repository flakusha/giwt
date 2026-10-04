// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the commit-wt `--no-verify` contract:
 *
 * - default: the spawned `git commit -S` argv contains NO `--no-verify`, so
 *   the consuming repo's pre-commit hook runs (git honours core.hooksPath);
 * - `--no-verify` passed: the flag appears in the argv, and only then;
 * - on commit failure, stderr tail is surfaced plus a remedy naming
 *   `--no-verify` (absent when the caller already opted out);
 * - the flag is consumed by the handler, never forwarded as message text.
 *
 * Resource contract (parallel-safe): each test owns a fresh mkdtemp()
 * fixture repo (unique path under /tmp) plus its own spawn stub, stream
 * spies, and process.exit stub — all allocated inside the test body and
 * released in that test's finally/teardown. No module-level mutable state
 * beyond the per-test `ctx` slot torn down in afterEach; no ordering
 * dependence (each test passes alone and in any order).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { commitWt } from "./commit-wt";

interface CommitWtCtx {
  root: string;
  config: WorktreeConfig;
  /** argv arrays of stubbed `git commit -S` invocations (per-test). */
  commitCalls: string[][];
  /** everything the test wrote to stdout/stderr through the spies. */
  output(): string;
  /** release spawn stub, stream spies, env overrides, exit stub. */
  teardown(): void;
}

/** Build a fully isolated per-test harness: fixture repo + stubbed pipeline. */
function makeCtx(opts: { commitExit: number; }): CommitWtCtx {
  const root = mkdtempSync(join("/tmp", "giwt-commit-wt-nv-"));
  const run = (cwd: string, args: string[]): void => {
    const p = Bun.spawnSync(["git", "-C", cwd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: isolatedGitEnv(),
    });
    if (p.exitCode !== 0) throw new Error(`git ${args}: ${p.stderr}`);
  };
  run(root, ["init", "-q", "-b", "master"]);
  // Persistent git config writes are prohibited for agents — set identity by
  // writing the fixture repo's config FILE directly instead of `git config`.
  const setIdentity = (repoDir: string): void => {
    appendFileSync(
      join(repoDir, ".git", "config"),
      "[user]\n\temail = t@t\n\tname = t\n",
    );
  };
  setIdentity(root);
  writeFileSync(join(root, "s.txt"), "s\n");
  run(root, ["add", "s.txt"]);
  run(root, ["commit", "-qm", "seed"]);
  // Worktree for a NON-protected branch — 'master' is protected by
  // DEFAULT_SETTINGS, so the happy path must resolve to tree/feature.
  const wt = resolve(root, "tree", "feature");
  mkdirSync(wt, { recursive: true });
  run(wt, ["init", "-q", "-b", "feature"]);
  setIdentity(wt);
  writeFileSync(join(wt, "d.txt"), "d\n");
  run(wt, ["add", "d.txt"]);
  const config: WorktreeConfig = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: resolve(root, "tree"),
    settings: DEFAULT_SETTINGS,
    agentGpgKeyId: "ABCDEF0123456789",
    agentGpgName: "t",
    agentGpgEmail: "t@t",
  };

  // Stub the commit pipeline: gpg probes succeed, `git commit -S` captures
  // argv and exits with commitExit, signature verification reports good.
  const real = Bun.spawnSync;
  const commitCalls: string[][] = [];
  Bun.spawnSync = ((cmd: unknown, opts2?: unknown) => {
    const argv = cmd as string[];
    if (argv[0] === "gpg") {
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    if (argv[0] === "git" && argv.includes("commit") && argv.includes("-S")) {
      commitCalls.push([...argv]);
      return {
        exitCode: opts.commitExit,
        stdout: Buffer.from(""),
        stderr: Buffer.from("pre-commit hook failed\neslint: violation\n"),
      };
    }
    if (argv[0] === "git" && argv.includes("--show-signature")) {
      return {
        exitCode: 0,
        stdout: Buffer.from("commit deadbeef\nGood signature\n"),
        stderr: Buffer.from(""),
      };
    }
    return real(cmd as never, opts2 as never);
  }) as unknown as typeof Bun.spawnSync;

  // Env overrides are scoped to this harness, not process-global setup.
  const prevEnv = {
    KEY: process.env.AGENT_GPG_KEY_ID,
    NAME: process.env.AGENT_GPG_NAME,
    EMAIL: process.env.AGENT_GPG_EMAIL,
    SKIP: process.env.GIWT_SKIP_GPG_PREFLIGHT,
  };
  process.env.AGENT_GPG_KEY_ID = config.agentGpgKeyId;
  process.env.AGENT_GPG_NAME = config.agentGpgName;
  process.env.AGENT_GPG_EMAIL = config.agentGpgEmail;
  process.env.GIWT_SKIP_GPG_PREFLIGHT = "1";

  const restores: Array<() => void> = [];
  const writes: string[] = [];
  // Stream capture is always installed — keeps runner output clean and the
  // harness hermetic regardless of test outcome.
  const push = (c: unknown): boolean => {
    writes.push(String(c));
    return true;
  };
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const stderrSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  restores.push(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
  const originalExit = process.exit;
  process.exit = ((code: number) => {
    throw new Error(`__exit__:${code}`);
  }) as never;

  return {
    root,
    config,
    commitCalls,
    output: () => writes.join(""),
    teardown(): void {
      Bun.spawnSync = real;
      for (const r of restores) r();
      process.exit = originalExit;
      const set = (k: string, v: string | undefined): void => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      };
      set("AGENT_GPG_KEY_ID", prevEnv.KEY);
      set("AGENT_GPG_NAME", prevEnv.NAME);
      set("AGENT_GPG_EMAIL", prevEnv.EMAIL);
      set("GIWT_SKIP_GPG_PREFLIGHT", prevEnv.SKIP);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

let ctx: CommitWtCtx | undefined;

beforeEach(() => {
  setLogLevel("error");
});

afterEach(() => {
  // Deterministic teardown even on failure — a leaked fixture or stub must
  // never poison sibling tests.
  ctx?.teardown();
  ctx = undefined;
  // The beforeEach above narrows the level to keep error-path captures quiet;
  // restore it or later test files in the same process lose info/success.
  setLogLevel("info");
});

describe("commit-wt --no-verify", () => {
  test("default argv omits --no-verify so the pre-commit hook runs", async () => {
    ctx = makeCtx({ commitExit: 0 });
    await commitWt(["feature", "feat: default keeps hooks"], ctx.config);
    expect(ctx.commitCalls.length).toBe(1);
    expect(ctx.commitCalls[0]?.includes("--no-verify")).toBe(false);
    expect(ctx.commitCalls[0]?.includes("-S")).toBe(true);
  });

  test("--no-verify passed appears in the spawn argv", async () => {
    ctx = makeCtx({ commitExit: 0 });
    await commitWt(["feature", "--no-verify", "feat: explicit skip"], ctx.config);
    expect(ctx.commitCalls.length).toBe(1);
    expect(ctx.commitCalls[0]?.includes("--no-verify")).toBe(true);
  });

  test("the flag is not forwarded as message text", async () => {
    ctx = makeCtx({ commitExit: 0 });
    await commitWt(["feature", "--no-verify", "feat: clean msg"], ctx.config);
    const mi = ctx.commitCalls[0]?.indexOf("-m");
    expect(ctx.commitCalls[0]?.[mi === undefined ? -1 : mi + 1]).toBe("feat: clean msg");
  });

  test("hook failure surfaces stderr tail and remedy naming --no-verify", async () => {
    ctx = makeCtx({ commitExit: 1 });
    try {
      await commitWt(["feature", "feat: hook rejects"], ctx.config);
      throw new Error("expected exit");
    } catch (err) {
      expect((err as Error).message).toContain("__exit__:1");
    }
    const out = ctx.output();
    expect(out).toContain("pre-commit hook failed");
    expect(out).toContain("--no-verify");
  });

  test("hook failure with --no-verify already passed omits the remedy", async () => {
    ctx = makeCtx({ commitExit: 1 });
    try {
      await commitWt(["feature", "--no-verify", "feat: hook rejects"], ctx.config);
      throw new Error("expected exit");
    } catch (err) {
      expect((err as Error).message).toContain("__exit__:1");
    }
    const out = ctx.output();
    expect(out).toContain("pre-commit hook failed");
    expect(out).not.toContain("Re-run with --no-verify");
  });
});
