// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { isolatedGitEnv } from "../../utils/git";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { executeStagingMerge } from "./staging";
import { releaseActiveStagingTeardown } from "./state";

/**
 * The squash/direct strategies gate on assertAgentGpgUnlocked() before any
 * mutation (staging.ts). That guard probes the REAL gpg-agent cache with the
 * developer's .credentials.env key — on a cold cache it process.exit(1)s the
 * bun test runner (environment- and file-order-dependent). These tests run a
 * stubbed signing pipeline at a fake key ("ABCDEF0123456789" is in no keyring,
 * so gpgMergeFlags already degrades to unsigned), so the real pre-flight has
 * nothing meaningful to probe. The GIWT_SKIP_GPG_PREFLIGHT seam is therefore
 * scoped per-test: each test owns a mkdtemp fixture under scratchRoot()
 * (afterEach rmSync) and the seam is set in beforeEach and removed in
 * afterEach, so no ambient env leaks to other files. The author-identity
 * guard matrix below still runs for real.
 */

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

function gitFixture(authorEmail: string): void {
  root = mkdtempSync(join(scratchRoot(), "giwt-staging-guard-"));
  git(["init", "-q", "-b", "dev"]);
  git(["config", "user.email", authorEmail]);
  git(["config", "user.name", "test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "s.txt"), "s\n");
  git(["add", "s.txt"]);
  git(["commit", "-qm", "seed"]);
  git(["checkout", "-qb", "feature"]);
  writeFileSync(join(root, "f.txt"), "f\n");
  git(["add", "f.txt"]);
  git(["commit", "-qm", "feature commit"]);
  git(["checkout", "-q", "dev"]);
  mkdirSync(resolve(root, "tree"));
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: resolve(root, "tree"),
    settings: DEFAULT_SETTINGS,
    agentGpgKeyId: "ABCDEF0123456789",
    agentGpgName: "test",
    agentGpgEmail: "test@giwt.local",
  };
}

/** Mock verify-commit to return success (no real GPG in tests). */
function mockVerifyCommit(): () => void {
  const real = Bun.spawnSync;
  Bun.spawnSync = ((cmd: string[], opts?: unknown) => {
    if (cmd[0] === "git" && cmd.includes("verify-commit")) {
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    return real(cmd as never, opts as never);
  }) as unknown as typeof Bun.spawnSync;
  return () => {
    Bun.spawnSync = real;
  };
}

beforeEach(() => {
  gitFixture("test@giwt.local");
  process.env.GIWT_SKIP_GPG_PREFLIGHT = "1";
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.GIWT_SKIP_GPG_PREFLIGHT;
});

describe("staging guard: squash path", () => {
  it("passes when author matches", () => {
    const result = executeStagingMerge("feature", "squash", false, config, "dev", false, []);
    expect(result).not.toBeNull();
  });

  it("refuses when author does not match", () => {
    git(["config", "user.email", "gate@example.com"]);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      (() => {
        throw new Error("__exit__:1");
      }) as never,
    );
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    let output = "";
    try {
      executeStagingMerge("feature", "squash", false, config, "dev", false, []);
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit__:1");
    } finally {
      output = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(output).toContain("refusing to squash merge");
    expect(output).toContain("gate@example.com");
    expect(output).toContain("test@giwt.local");
  });

  it("allows override with flag", () => {
    git(["config", "user.email", "gate@example.com"]);
    const result = executeStagingMerge(
      "feature",
      "squash",
      false,
      config,
      "dev",
      false,
      ["--allow-author-override"],
    );
    expect(result).not.toBeNull();
  });
});

describe("staging guard: direct merge path", () => {
  it("passes when author matches", () => {
    const restore = mockVerifyCommit();
    try {
      const result = executeStagingMerge("feature", "direct", true, config, "dev", false, []);
      expect(result).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("refuses when author does not match", () => {
    git(["config", "user.email", "gate@example.com"]);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      (() => {
        throw new Error("__exit__:1");
      }) as never,
    );
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    let output = "";
    try {
      executeStagingMerge("feature", "direct", true, config, "dev", false, []);
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit__:1");
    } finally {
      output = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(output).toContain("refusing to merge");
    expect(output).toContain("gate@example.com");
    expect(output).toContain("test@giwt.local");
  });

  it("allows override with flag", () => {
    git(["config", "user.email", "gate@example.com"]);
    const restore = mockVerifyCommit();
    try {
      const result = executeStagingMerge(
        "feature",
        "direct",
        true,
        config,
        "dev",
        false,
        ["--allow-author-override"],
      );
      expect(result).not.toBeNull();
    } finally {
      restore();
    }
  });
});

describe("staging guard: rebase strategy (single pre-mutation guard)", () => {
  it("refuses when author does not match — rebase path is guarded too", () => {
    git(["config", "user.email", "gate@example.com"]);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      (() => {
        throw new Error("__exit__:1");
      }) as never,
    );
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    let output = "";
    try {
      executeStagingMerge("feature", "rebase", false, config, "dev", false, []);
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit__:1");
    } finally {
      output = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(output).toContain("refusing to rebase");
  });

  it("guard refusal publishes a staging teardown that removes the worktree", () => {
    git(["config", "user.email", "gate@example.com"]);
    const exitSpy = spyOn(process, "exit").mockImplementation(
      (() => {
        throw new Error("__exit__:1");
      }) as never,
    );
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      executeStagingMerge("feature", "rebase", false, config, "dev", false, []);
      expect.unreachable("should have exited");
    } catch {
      // expected — the guard refuses before any mutation
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
    // The staging worktree exists (created before the guard) and the
    // published teardown must remove it on the exit-hook path.
    const leftovers = () => readdirSync(config.treeDir).filter((e) => e.startsWith(".finalize-"));
    expect(leftovers().length).toBe(1);
    releaseActiveStagingTeardown();
    expect(leftovers().length).toBe(0);
    // Idempotent: a second release is a no-op.
    releaseActiveStagingTeardown();
    expect(leftovers().length).toBe(0);
  });

  it("passes when author matches and leaves no squash msg file behind", () => {
    const result = executeStagingMerge("feature", "rebase", false, config, "dev", false, []);
    expect(result).not.toBeNull();
    // The squash scratch msg file lives inside the staging worktree — it
    // must never appear in the main repo's .git (leak invariant).
    expect(existsSync(join(root, ".git", "GIWT_SQUASH_MSG"))).toBe(false);
  });
});
