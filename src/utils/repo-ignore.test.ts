// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the repo-ignore lookup (repoIgnoredPaths).
 *
 * The repo's own .gitignore is the source of truth; the user's global
 * excludesFile is neutralized. `--no-index` matters: a retired artifact is
 * still in the index at conflict time, and without it the path would read
 * as tracked, not ignored.
 *
 * Resource contract (parallel-safe): each test owns a unique mkdtemp git
 * repo torn down in afterEach.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "./git";
import { repoIgnoredPaths } from "./repo-ignore";
import { scratchRoot } from "./scratch-tmp";

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedGitEnv(), GIT_EDITOR: "true" },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function makeRepo(): string {
  root = mkdtempSync(join(scratchRoot(), "giwt-repo-ignore-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "giwt-test@example.com");
  git(root, "config", "user.name", "giwt test");
  git(root, "config", "commit.gpgsign", "false");
  return root;
}

describe("repoIgnoredPaths", () => {
  test("a .gitignore-listed path is reported ignored", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, ".gitignore"), "gen.txt\n");
    writeFileSync(join(repo, "gen.txt"), "generated\n");

    expect(repoIgnoredPaths(repo, ["gen.txt"])).toEqual(new Set(["gen.txt"]));
  });

  test("a tracked-but-ignored path is still reported ignored", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, ".gitignore"), "gen.txt\n");
    writeFileSync(join(repo, "gen.txt"), "generated\n");
    git(repo, "add", "-f", "gen.txt");
    git(repo, "commit", "-qm", "track the artifact");

    expect(repoIgnoredPaths(repo, ["gen.txt"])).toEqual(new Set(["gen.txt"]));
  });

  test("a non-ignored path is not reported", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, ".gitignore"), "gen.txt\n");
    writeFileSync(join(repo, "kept.txt"), "source\n");

    expect(repoIgnoredPaths(repo, ["kept.txt"])).toEqual(new Set());
  });

  test("a path ignored only by the global excludesFile is NOT reported", () => {
    const repo = makeRepo();
    const globalIgnore = join(repo, "global-ignore");
    writeFileSync(globalIgnore, "only-global.txt\n");
    git(repo, "config", "core.excludesFile", globalIgnore);
    writeFileSync(join(repo, "only-global.txt"), "dot-dir hygiene\n");

    expect(repoIgnoredPaths(repo, ["only-global.txt"])).toEqual(new Set());
  });

  test("a git failure surfaces instead of reading as not ignored", () => {
    expect(() => repoIgnoredPaths(join(root, "missing"), ["gen.txt"])).toThrow(
      "check-ignore failed",
    );
  });
});
