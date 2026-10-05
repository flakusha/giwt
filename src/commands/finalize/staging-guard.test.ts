// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scratchRoot } from "../../utils/scratch-tmp";
import { isolatedGitEnv } from "../../utils/git";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import type { WorktreeConfig } from "../../utils/config";
import { executeStagingMerge } from "./staging";

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
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("staging guard: squash path", () => {
  it("passes when author matches", () => {
    const result = executeStagingMerge("feature", "squash", false, config, "dev", false, []);
    expect(result).not.toBeNull();
  });

  it("refuses when author does not match", () => {
    git(["config", "user.email", "gate@example.com"]);
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__:1");
    }) as never);
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      executeStagingMerge("feature", "squash", false, config, "dev", false, []);
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit__:1");
    }
    const output = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("refusing to squash merge");
    expect(output).toContain("gate@example.com");
    expect(output).toContain("test@giwt.local");
    exitSpy.mockRestore();
    errSpy.mockRestore();
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
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__:1");
    }) as never);
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      executeStagingMerge("feature", "direct", true, config, "dev", false, []);
      expect.unreachable("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__exit__:1");
    }
    const output = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("refusing to merge");
    expect(output).toContain("gate@example.com");
    expect(output).toContain("test@giwt.local");
    exitSpy.mockRestore();
    errSpy.mockRestore();
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
