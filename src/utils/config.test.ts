// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for config helpers: linkWorktreeCredentials (root `.credentials.env`
 * is symlinked into fresh worktrees, idempotently), branchToPath, loadConfig
 * layering/credentials parsing, and resolveBranch fallbacks.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { branchToPath, linkWorktreeCredentials, loadConfig, resolveBranch } from "./config";
import { DEFAULT_SETTINGS } from "./settings";

/** Run git in `cwd` with the ambient GIT_* context stripped. */
function git(args: string[], cwd: string): string {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: env as Record<string, string>,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** Minimal real git repo with one commit — loadConfig/resolveBranch need it. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "giwt-config-repo-"));
  git(["init", "-q", "-b", "main"], root);
  git(["config", "user.email", "test@giwt.local"], root);
  git(["config", "user.name", "giwt test"], root);
  git(["config", "commit.gpgsign", "false"], root);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."], root);
  git(["commit", "-qm", "seed"], root);
  return root;
}

describe("linkWorktreeCredentials", () => {
  it("symlinks root credentials into the worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "ll-creds-root-"));
    const wt = mkdtempSync(join(tmpdir(), "ll-creds-wt-"));
    try {
      writeFileSync(join(root, ".credentials.env"), "AGENT_GPG_KEY_ID=test");
      linkWorktreeCredentials(root, wt);
      expect(readlinkSync(join(wt, ".credentials.env"))).toBe(join(root, ".credentials.env"));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("skips silently when root has no credentials file", () => {
    const root = mkdtempSync(join(tmpdir(), "ll-creds-noroot-"));
    const wt = mkdtempSync(join(tmpdir(), "ll-creds-nowt-"));
    try {
      linkWorktreeCredentials(root, wt);
      expect(existsSync(join(wt, ".credentials.env"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("keeps an existing worktree credentials file", () => {
    const root = mkdtempSync(join(tmpdir(), "ll-creds-keep-root-"));
    const wt = mkdtempSync(join(tmpdir(), "ll-creds-keep-wt-"));
    try {
      writeFileSync(join(root, ".credentials.env"), "AGENT_GPG_KEY_ID=root");
      const wtCreds = join(wt, ".credentials.env");
      symlinkSync(join(root, ".credentials.env"), wtCreds);
      linkWorktreeCredentials(root, wt);
      expect(readlinkSync(wtCreds)).toBe(join(root, ".credentials.env"));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

describe("branchToPath", () => {
  it("replaces every slash with a dash", () => {
    expect(branchToPath("feature/x/y")).toBe("feature-x-y");
    expect(branchToPath("plain")).toBe("plain");
  });
});

describe("loadConfig", () => {
  let savedEnv: { REPO_ROOT: string | undefined; TREE_DIR: string | undefined; };

  beforeEach(() => {
    savedEnv = {
      REPO_ROOT: process.env.REPO_ROOT,
      TREE_DIR: process.env.TREE_DIR,
    };
    delete process.env.REPO_ROOT;
    delete process.env.TREE_DIR;
  });

  afterEach(() => {
    if (savedEnv.REPO_ROOT === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = savedEnv.REPO_ROOT;
    if (savedEnv.TREE_DIR === undefined) delete process.env.TREE_DIR;
    else process.env.TREE_DIR = savedEnv.TREE_DIR;
  });

  it("resolves agent credentials with quote stripping via the parent walk", async () => {
    const root = makeRepo();
    try {
      writeFileSync(
        join(root, ".credentials.env"),
        [
          "# comment line",
          "",
          "not-a-pair",
          "AGENT_GPG_KEY_ID=\"ABC123\"",
          "AGENT_GPG_NAME='Agent Name'",
          "AGENT_GPG_EMAIL=agent@giwt.local",
        ].join("\n"),
      );
      process.env.REPO_ROOT = root;
      const config = await loadConfig();
      expect(config.repoRoot).toBe(root);
      // REPO_ROOT pins the invocation root to the same root
      expect(config.worktreeRoot).toBe(root);
      expect(config.treeDir).toBe(resolve(root, DEFAULT_SETTINGS.paths.tree));
      expect(config.settings).toEqual(DEFAULT_SETTINGS);
      expect(config.agentGpgKeyId).toBe("ABC123");
      expect(config.agentGpgName).toBe("Agent Name");
      expect(config.agentGpgEmail).toBe("agent@giwt.local");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("honors TREE_DIR and omits agent fields when no credentials file exists", async () => {
    const root = makeRepo();
    const treeDir = join(root, "custom-tree");
    mkdirSync(treeDir);
    try {
      process.env.REPO_ROOT = root;
      process.env.TREE_DIR = treeDir;
      const config = await loadConfig();
      expect(config.treeDir).toBe(treeDir);
      expect("agentGpgKeyId" in config).toBe(false);
      expect("agentGpgName" in config).toBe(false);
      expect("agentGpgEmail" in config).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the current checkout as worktreeRoot when REPO_ROOT is unset", async () => {
    const root = makeRepo();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const config = await loadConfig();
      expect(config.repoRoot).toBe(root);
      expect(config.worktreeRoot).toBe(root);
      expect(config.treeDir).toBe(resolve(root, "tree"));
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveBranch", () => {
  it("passes through a valid branch ref", async () => {
    const root = makeRepo();
    try {
      expect(await resolveBranch(root, "main")).toBe("main");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers the branch from a worktree addressed by its directory name", async () => {
    const root = makeRepo();
    try {
      const treeDir = resolve(root, "tree");
      mkdirSync(treeDir);
      const wtPath = resolve(treeDir, "feat-x");
      git(["worktree", "add", "-q", "-b", "feat/x", wtPath, "main"], root);
      expect(await resolveBranch(root, "feat-x")).toBe("feat/x");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns empty for neither a ref nor a worktree directory", async () => {
    const root = makeRepo();
    try {
      mkdirSync(resolve(root, "tree"));
      expect(await resolveBranch(root, "never-created")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
