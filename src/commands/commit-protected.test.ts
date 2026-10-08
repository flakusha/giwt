// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "../utils/scratch-tmp";
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the on-protected-branch direct-commit scenario:
 * `giwt commit` and `giwt commit-wt <protected> --on-protected`.
 *
 * Contract covered here:
 * - `commit` refuses a direct commit on a protected branch without the
 *   explicit --on-protected opt-in, and proceeds past the guard with it;
 * - `commit-wt` keeps refusing a protected branch without the flag, routes
 *   the commit into the main checkout with it, rejects the flag on a
 *   non-protected branch, and rejects it when the main checkout sits on a
 *   different branch;
 * - the `commit` signing pipeline runs under a process-boundary stub (gpg
 *   probes succeed, `git commit -S` succeeds without a keyring); the
 *   `commit-wt` routed happy path signs with the real agent key from
 *   .credentials.env and therefore requires an unlocked gpg agent — same
 *   class of dependency as the gpg guard tests.
 *
 * Resource contract (parallel-safe): each test owns a fresh mkdtemp()
 * fixture repo (branch `master`, protected by DEFAULT_SETTINGS); child git
 * runs with isolatedGitEnv(); everything is removed in afterEach. The
 * GIWT_SKIP_GPG_PREFLIGHT seam is set at module scope (the stubbed
 * pipeline has nothing for the real pre-flight to probe) and deleted in
 * afterAll so other test files are unaffected.
 */

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { setLogLevel } from "../utils/output";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { commit } from "./commit";
import { commitWt } from "./commit-wt";

process.env.GIWT_SKIP_GPG_PREFLIGHT = "1";
afterAll(() => {
  delete process.env.GIWT_SKIP_GPG_PREFLIGHT;
});

let root: string;
let config: WorktreeConfig;

function git(args: string[], cwd: string = root): string {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (p.exitCode !== 0) throw new Error(`git ${args}: ${p.stderr}`);
  return p.stdout.toString();
}

function gitFixture(): void {
  root = mkdtempSync(join(scratchRoot(), "giwt-v3-"));
  git(["init", "-q", "-b", "master"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "s.txt"), "s\n");
  git(["add", "s.txt"]);
  git(["commit", "-qm", "seed"]);
  writeFileSync(join(root, "d.txt"), "d\n");
  git(["add", "d.txt"]);
  mkdirSync(resolve(root, "tree"));
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: resolve(root, "tree"),
    settings: DEFAULT_SETTINGS,
    agentGpgKeyId: "ABCDEF0123456789",
    agentGpgName: "t",
    // Must match the fixture repo's user.email (the AUTHOR the guard
    // compares) — a mismatch makes the author guard process.exit mid-test.
    agentGpgEmail: "test@giwt.local",
  };
}

beforeEach(() => {
  gitFixture();
  setLogLevel("info");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Install a signing-pipeline stub: gpg probes succeed, `git commit -S`
 * fails with `commitExit` when set, signature verification reports a good
 * signature unless `goodSignature` is false. Returns the restore function.
 */
function installSigningStub(
  opts: { commitExit?: number; goodSignature?: boolean; } = {},
): () => void {
  const real = Bun.spawnSync;
  const ok = () => ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
  Bun.spawnSync = ((cmd: string[], opts2?: unknown) => {
    if (cmd[0] === "gpg") return ok();
    if (cmd[0] === "git" && cmd.includes("commit") && cmd.includes("-S")) {
      if (opts.commitExit !== undefined) {
        return { exitCode: opts.commitExit, stdout: Buffer.from(""), stderr: Buffer.from("") };
      }
      return ok();
    }
    if (cmd[0] === "git" && cmd.includes("--show-signature")) {
      const sig = opts.goodSignature === false ? "No signature" : "Good signature";
      return {
        exitCode: 0,
        stdout: Buffer.from(`commit deadbeef\n${sig}\n`),
        stderr: Buffer.from(""),
      };
    }
    if (cmd[0] === "git" && cmd.includes("verify-commit")) {
      return opts.goodSignature === false
        ? { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") }
        : ok();
    }
    return real(cmd as never, opts2 as never);
  }) as unknown as typeof Bun.spawnSync;
  return () => {
    Bun.spawnSync = real;
  };
}

/** Config with agent credentials — the signing pipeline needs them. */
function credConfig(): WorktreeConfig {
  return {
    ...config,
    agentGpgKeyId: "ABCDEF0123456789",
    agentGpgName: "giwt test",
    agentGpgEmail: "test@giwt.local",
  };
}

/** Stage a unique file so the staged-change guard passes. */
function stageChange(name: string, cwd: string = root): void {
  writeFileSync(join(cwd, name), `${name}\n`);
  git(["add", name], cwd);
}

function captureStreams(): { lines: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const push = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(push as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(push as never);
  return {
    lines: () => chunks.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

/** Run `fn` expecting process.exit(1); returns captured output. */
async function expectExit1(fn: (cfg: WorktreeConfig) => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const push = (c: unknown): boolean => {
    chunks.push(String(c));
    return true;
  };
  const o = spyOn(process.stdout, "write").mockImplementation(push as never);
  const e = spyOn(process.stderr, "write").mockImplementation(push as never);
  const original = process.exit;
  const codes: number[] = [];
  process.exit = ((code: number) => {
    codes.push(code);
    throw new Error(`__exit__:${code}`);
  }) as never;
  try {
    let aborted = false;
    try {
      await fn(config);
    } catch (err) {
      expect((err as Error).message).toBe("__exit__:1");
      aborted = true;
    }
    expect(aborted).toBe(true);
    expect(codes).toEqual([1]);
    return chunks.join("");
  } finally {
    process.exit = original;
    o.mockRestore();
    e.mockRestore();
  }
}

describe("commit/commit-wt: on-protected direct commit", () => {
  test("refuses without --on-protected", async () => {
    const out = await expectExit1((cfg) => commit(["fix(x): direct"], cfg));
    expect(out).toContain("refusing direct commit on protected branch 'master'");
  });
  test("rejects a non-conventional commit message", async () => {
    const out = await expectExit1(() =>
      commit(["--on-protected", "not conventional"], credConfig())
    );
    expect(out).toContain("commit message rejected");
  });

  test("reports missing agent name/email", async () => {
    const halfCreds: WorktreeConfig = {
      repoRoot: config.repoRoot,
      worktreeRoot: config.worktreeRoot,
      treeDir: config.treeDir,
      settings: config.settings,
      agentGpgKeyId: "ABCDEF0123456789",
    };
    const out = await expectExit1(() => commit(["--on-protected", "fix(x): direct"], halfCreds));
    expect(out).toContain("AGENT_GPG_NAME/AGENT_GPG_EMAIL not set");
  });

  test("reports unconfigured git author in the target checkout", async () => {
    // Fresh repo without user.name/user.email — the author lookup fails
    // before any signing attempt.
    const bare = mkdtempSync(join(scratchRoot(), "giwt-noauthor-"));
    try {
      git(["init", "-q", "-b", "master"], bare);
      git(["config", "commit.gpgsign", "false"], bare);
      writeFileSync(join(bare, "f.txt"), "f\n");
      git(["add", "f.txt"], bare);
      git(["-c", "user.name=seed", "-c", "user.email=seed@t", "commit", "-qm", "seed"], bare);
      writeFileSync(join(bare, "d.txt"), "d\n");
      git(["add", "d.txt"], bare);
      const otherConfig: WorktreeConfig = {
        ...credConfig(),
        repoRoot: bare,
        worktreeRoot: bare,
        treeDir: resolve(bare, "tree"),
      };
      const out = await expectExit1(() =>
        commit(["--on-protected", "fix(x): direct"], otherConfig)
      );
      expect(out).toContain("git user.name/user.email not configured");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test("reports no staged changes", async () => {
    git(["reset", "-q"]);
    const out = await expectExit1(() => commit(["--on-protected", "fix(x): direct"], credConfig()));
    expect(out).toContain("no staged changes");
  });

  test("refuses to commit staged dependency directories", async () => {
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "i.js"), "i\n");
    git(["add", "-f", "node_modules/pkg/i.js"]);
    const out = await expectExit1(() => commit(["--on-protected", "fix(x): direct"], credConfig()));
    expect(out).toContain("refusing to commit dependency directory");
  });

  test("reports a signing failure from the git commit step", async () => {
    stageChange("fail.txt");
    const restore = installSigningStub({ commitExit: 1 });
    try {
      const out = await expectExit1(() =>
        commit(["--on-protected", "fix(x): direct"], credConfig())
      );
      expect(out).toContain("commit failed (exit 1)");
    } finally {
      restore();
    }
  });

  test("warns when signature verification is inconclusive", async () => {
    stageChange("unclear.txt");
    const restore = installSigningStub({ goodSignature: false });
    const cap = captureStreams();
    try {
      await commit(["--on-protected", "fix(x): direct"], credConfig());
      expect(cap.lines()).toContain("signature verification failed");
    } finally {
      restore();
      cap.restore();
    }
  });

  test("does not set GIT_COMMITTER_NAME/EMAIL env (committer resolves from repo config)", async () => {
    const chunks: string[] = [];
    const push = (c: unknown): boolean => {
      chunks.push(String(c));
      return true;
    };
    const o = spyOn(process.stdout, "write").mockImplementation(push as never);
    const e = spyOn(process.stderr, "write").mockImplementation(push as never);
    const real = Bun.spawnSync;
    const capturedEnvs: Record<string, string>[] = [];
    const ok = () => ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    Bun.spawnSync = ((cmd: string[], opts?: unknown) => {
      if (cmd[0] === "gpg") return ok();
      if (cmd[0] === "git" && cmd.includes("commit") && cmd.includes("-S")) {
        const env = (opts as { env?: Record<string, string>; })?.env ?? {};
        capturedEnvs.push(env);
        return ok();
      }
      if (cmd[0] === "git" && cmd.includes("--show-signature")) {
        return {
          exitCode: 0,
          stdout: Buffer.from("commit deadbeef\nGood signature\n"),
          stderr: Buffer.from(""),
        };
      }
      if (cmd[0] === "git" && cmd.includes("verify-commit")) return ok();
      return real(cmd as never, opts as never);
    }) as unknown as typeof Bun.spawnSync;
    try {
      await commit(["--on-protected", "fix(x): direct"], config);
      expect(capturedEnvs.length).toBe(1);
      expect(capturedEnvs[0]?.["GIT_COMMITTER_NAME"]).toBeUndefined();
      expect(capturedEnvs[0]?.["GIT_COMMITTER_EMAIL"]).toBeUndefined();
    } finally {
      Bun.spawnSync = real;
      o.mockRestore();
      e.mockRestore();
    }
  });

  test("committer log line reflects the resolved repo-config identity", async () => {
    const chunks: string[] = [];
    const push = (c: unknown): boolean => {
      chunks.push(String(c));
      return true;
    };
    const o = spyOn(process.stdout, "write").mockImplementation(push as never);
    const e = spyOn(process.stderr, "write").mockImplementation(push as never);
    const real = Bun.spawnSync;
    const ok = () => ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    Bun.spawnSync = ((cmd: string[], opts?: unknown) => {
      if (cmd[0] === "gpg") return ok();
      if (cmd[0] === "git" && cmd.includes("commit") && cmd.includes("-S")) return ok();
      if (cmd[0] === "git" && cmd.includes("verify-commit")) return ok();
      return real(cmd as never, opts as never);
    }) as unknown as typeof Bun.spawnSync;
    try {
      await commit(["--on-protected", "fix(x): direct"], config);
      const out = chunks.join("");
      expect(out).toContain("Committer: giwt test <test@giwt.local> (from repo config)");
      expect(out).not.toContain("Committer: t <");
    } finally {
      Bun.spawnSync = real;
      o.mockRestore();
      e.mockRestore();
    }
  });

  test("blocks --no-verify when identity gate is present", async () => {
    const gateDir = join(root, ".githooks");
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(join(gateDir, "identity-gate.sh"), "#!/bin/sh\n# fake gate\n");
    const out = await expectExit1(() =>
      commit(["--on-protected", "--no-verify", "fix(x): direct"], credConfig())
    );
    expect(out).toContain("--no-verify blocked");
    expect(out).toContain("identity-gate.sh");
  });

  test("creates a signed commit on the protected branch with --on-protected", async () => {
    const chunks: string[] = [];
    const push = (c: unknown): boolean => {
      chunks.push(String(c));
      return true;
    };
    const o = spyOn(process.stdout, "write").mockImplementation(push as never);
    const e = spyOn(process.stderr, "write").mockImplementation(push as never);
    const real = Bun.spawnSync;
    const ok = () => ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    Bun.spawnSync = ((cmd: string[], opts?: unknown) => {
      if (cmd[0] === "gpg") return ok();
      if (cmd[0] === "git" && cmd.includes("commit") && cmd.includes("-S")) return ok();
      if (cmd[0] === "git" && cmd.includes("--show-signature")) {
        return {
          exitCode: 0,
          stdout: Buffer.from("commit deadbeef\nGood signature\n"),
          stderr: Buffer.from(""),
        };
      }
      if (cmd[0] === "git" && cmd.includes("verify-commit")) return ok();
      return real(cmd as never, opts as never);
    }) as unknown as typeof Bun.spawnSync;
    try {
      await commit(["--on-protected", "fix(x): direct"], config);
      expect(chunks.join("")).toContain("Commit created and GPG-signed");
    } finally {
      Bun.spawnSync = real;
      o.mockRestore();
      e.mockRestore();
    }
  });

  test("passes the guard with --on-protected (fails later on missing creds)", async () => {
    const noCreds: WorktreeConfig = {
      repoRoot: config.repoRoot,
      worktreeRoot: config.worktreeRoot,
      treeDir: config.treeDir,
      settings: config.settings,
    };
    const out = await expectExit1(() => commit(["--on-protected", "fix(x): direct"], noCreds));
    expect(out).toContain("direct commit on protected branch 'master'");
    expect(out).toContain("AGENT_GPG_KEY_ID not set");
  });

  test("wt refuses without --on-protected", async () => {
    const out = await expectExit1((cfg) => commitWt(["master", "fix(x): direct"], cfg));
    expect(out).toContain("cannot commit-wt on protected branch 'master'");
  });

  test("wt routes into the main checkout with --on-protected", async () => {
    // Routing proof: the pipeline targets the repo root ('master' checkout),
    // not a tree/ worktree. Signing succeeds or fails depending on whether
    // the fake key materializes in a keyring; either way the commit step ran
    // against the main checkout.
    const cap = captureStreams();
    const original = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never;
    try {
      try {
        await commitWt(["master", "--on-protected", "fix(x): direct"], credConfig());
      } catch (err) {
        // exit(1) from the commit-failure path is acceptable.
        if (!(err instanceof Error) || !err.message.startsWith("__exit__:")) throw err;
      }
      const out = cap.lines();
      expect(out).toContain("direct commit on protected branch 'master'");
      expect(out).toContain("Creating GPG-signed commit in 'master'");
      expect(out).toContain("Commit created:");
    } finally {
      process.exit = original;
      cap.restore();
    }
  });

  test("wt requires a commit message", async () => {
    const out = await expectExit1((cfg) => commitWt(["master"], cfg));
    expect(out).toContain("commit message rejected");
  });

  test("wt requires a branch when the message comes from a file", async () => {
    const msgFile = join(root, "msg.txt");
    writeFileSync(msgFile, "fix(x): from file\n");
    const out = await expectExit1((cfg) => commitWt(["-F", msgFile], cfg));
    expect(out).toContain("branch required");
  });

  test("wt rejects a non-conventional commit message", async () => {
    const out = await expectExit1((cfg) => commitWt(["master", "not conventional"], cfg));
    expect(out).toContain("commit message rejected");
  });

  test("wt reports no staged changes in the main checkout", async () => {
    git(["reset", "-q"]);
    const out = await expectExit1((cfg) =>
      commitWt(["master", "--on-protected", "fix(x): direct"], cfg)
    );
    expect(out).toContain("no staged changes in worktree 'master'");
  });

  test("wt refuses to commit staged dependency directories", async () => {
    mkdirSync(join(root, "node_modules", "wt-pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "wt-pkg", "i.js"), "i\n");
    git(["add", "-f", "node_modules/wt-pkg/i.js"]);
    const out = await expectExit1((cfg) =>
      commitWt(["master", "--on-protected", "fix(x): direct"], cfg)
    );
    expect(out).toContain("refusing to commit dependency directory");
  });

  test("wt reports a signing failure from the git commit step", async () => {
    stageChange("wt-fail.txt");
    const restore = installSigningStub({ commitExit: 1 });
    try {
      const out = await expectExit1((cfg) =>
        commitWt(["master", "--on-protected", "fix(x): direct"], cfg)
      );
      expect(out).toContain("commit failed (exit 1)");
    } finally {
      restore();
    }
  });

  test("wt warns when signature verification is inconclusive", async () => {
    stageChange("wt-unclear.txt");
    const restore = installSigningStub({ goodSignature: false });
    const cap = captureStreams();
    try {
      await commitWt(["master", "--on-protected", "fix(x): direct"], credConfig());
      expect(cap.lines()).toContain("signature verification unclear");
    } finally {
      restore();
      cap.restore();
    }
  });

  test("wt reports a missing worktree", async () => {
    const out = await expectExit1((cfg) => commitWt(["never-created", "fix(x): y"], cfg));
    expect(out).toContain("worktree not found for branch 'never-created'");
  });

  test("wt refuses when the worktree has no user.name/user.email", async () => {
    // Stand-in worktree dir: .git present, staged change, but no local identity.
    const wt = resolve(root, "tree", "feature");
    mkdirSync(wt, { recursive: true });
    const p = Bun.spawnSync(["git", "init", "-q", wt], {
      stdout: "ignore",
      stderr: "ignore",
      env: isolatedGitEnv(),
    });
    if (p.exitCode !== 0) throw new Error("git init failed");
    stageChange("f.txt", wt);
    const chunks: string[] = [];
    const push = (c: unknown): boolean => {
      chunks.push(String(c));
      return true;
    };
    const o = spyOn(process.stdout, "write").mockImplementation(push as never);
    const e = spyOn(process.stderr, "write").mockImplementation(push as never);
    const original = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never;
    try {
      await commitWt(["feature", "fix(x): y"], config);
      throw new Error("expected exit");
    } catch (err) {
      expect((err as Error).message).toBe("__exit__:1");
    } finally {
      process.exit = original;
      o.mockRestore();
      e.mockRestore();
    }
    expect(chunks.join("")).toContain("worktree user.name/user.email not configured");
  });

  test("wt rejects --on-protected on non-protected", async () => {
    git(["checkout", "-qb", "feature"]);
    const out = await expectExit1((cfg) =>
      commitWt(["feature", "--on-protected", "fix(x): y"], cfg)
    );
    expect(out).toContain("--on-protected given but 'feature' is not a protected branch");
  });

  test("wt rejects --on-protected when checkout elsewhere", async () => {
    git(["checkout", "-qb", "feature"]);
    const out = await expectExit1((cfg) =>
      commitWt(["master", "--on-protected", "fix(x): direct"], cfg)
    );
    expect(out).toContain("main checkout is on 'feature', not 'master'");
  });

  test("commit-wt signs in the main checkout with --on-protected", async () => {
    const chunks: string[] = [];
    const push = (c: unknown): boolean => {
      chunks.push(String(c));
      return true;
    };
    const o = spyOn(process.stdout, "write").mockImplementation(push as never);
    const e = spyOn(process.stderr, "write").mockImplementation(push as never);
    const real = Bun.spawnSync;
    const ok = () => ({ exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    Bun.spawnSync = ((cmd: string[], opts?: unknown) => {
      if (cmd[0] === "gpg") return ok();
      if (cmd[0] === "git" && cmd.includes("commit") && cmd.includes("-S")) return ok();
      if (cmd[0] === "git" && cmd.includes("--show-signature")) {
        return {
          exitCode: 0,
          stdout: Buffer.from("commit deadbeef\nGood signature\n"),
          stderr: Buffer.from(""),
        };
      }
      if (cmd[0] === "git" && cmd.includes("verify-commit")) return ok();
      return real(cmd as never, opts as never);
    }) as unknown as typeof Bun.spawnSync;
    try {
      await commit(["--on-protected", "fix(x): direct"], config);
      expect(chunks.join("")).toContain("Commit created and GPG-signed");
    } finally {
      Bun.spawnSync = real;
      o.mockRestore();
      e.mockRestore();
    }
  });
});
