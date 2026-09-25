// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Unit tests for the user-facing error reporters in `./errors`. Closes the
 * coverage gap on the `else` branches (empty candidate list) that the
 * integration tests leave uncovered when seeding a non-empty repo.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { reportMissingBase, reportMissingBranch } from "./errors";

/** Run git in a fixture repo, stripping GIT_* env to avoid parent leaks. */
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

/** Build a minimal git repo with exactly the requested branch set on top of one commit. */
function makeRepo(branches: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "giwt-errors-"));
  git(["init", "-q", "-b", "main"], root);
  git(["config", "user.email", "t@g.local"], root);
  git(["config", "user.name", "t"], root);
  git(["config", "commit.gpgsign", "false"], root);
  // Seed a single commit so subsequent `git branch <b> main` has a target.
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(["add", "."], root);
  git(["commit", "-qm", "seed"], root);
  if (branches.length === 0) {
    // Empty set: caller wants the no-candidates else-branch path. Detach HEAD
    // and prune refs/heads/main directly so `git branch` lists nothing.
    git(["checkout", "--detach", "HEAD"], root);
    git(["update-ref", "-d", "refs/heads/main"], root);
  } else {
    for (const b of branches) {
      if (b === "main") continue;
      git(["branch", b, "main"], root);
    }
  }
  return root;
}

/** Capture log()/raw() writes across stdout + stderr; restore on teardown. */
function capture(): { lines: () => string; restore: () => void; } {
  const writes: string[] = [];
  const collect = (chunk: unknown): true => {
    writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as ArrayBuffer));
    return true;
  };
  const outSpy = spyOn(process.stdout, "write").mockImplementation(collect as never);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(collect as never);
  return {
    lines: () => writes.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe("reportMissingBase", () => {
  let root: string;

  beforeEach(() => {
    delete process.env.REPO_ROOT;
    delete process.env.TREE_DIR;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("names the missing ref + lists existing branches + giwt.toml override + explicit escape hatch", async () => {
    root = makeRepo(["main", "develop", "release/1.0"]);
    process.env.REPO_ROOT = root;
    const config = await loadConfig();
    const cap = capture();
    try {
      reportMissingBase("nope", "feature/x", config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("base 'nope' does not exist");
    expect(out).toContain("Existing branches you can base on: develop, main, release/1.0");
    expect(out).toContain("[branches] root = \"<branch>\"");
    expect(out).toContain("Or pass one explicitly: giwt new-branch feature/x <base>");
  });

  it("falls back to the commit/tag tip when the repo has no local branches", async () => {
    root = makeRepo([]);
    process.env.REPO_ROOT = root;
    const config = await loadConfig();
    const cap = capture();
    try {
      reportMissingBase("nope", "feature/x", config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain(
      "No local branches exist yet — pass a commit or tag as the base instead.",
    );
    expect(out).toContain("[branches] root = \"<branch>\"");
    expect(out).toContain("giwt new-branch feature/x <base>");
  });
});

describe("reportMissingBranch", () => {
  let root: string;

  beforeEach(() => {
    delete process.env.REPO_ROOT;
    delete process.env.TREE_DIR;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("names the missing branch + lists checkable candidates + giwt new-branch escape hatch", async () => {
    root = makeRepo(["main", "develop"]);
    process.env.REPO_ROOT = root;
    const config = await loadConfig();
    const cap = capture();
    try {
      reportMissingBranch("ghost", config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain("branch 'ghost' does not exist");
    expect(out).toContain("Existing branches you can check out: develop, main");
    expect(out).toContain("Or create it: giwt new-branch ghost [base]");
  });

  it("falls back to the new-branch invocation tip when the repo has no local branches", async () => {
    root = makeRepo([]);
    process.env.REPO_ROOT = root;
    const config = await loadConfig();
    const cap = capture();
    try {
      reportMissingBranch("ghost", config);
    } finally {
      cap.restore();
    }
    const out = cap.lines();
    expect(out).toContain(
      "No local branches exist yet — create one first: giwt new-branch <name> [base]",
    );
    expect(out).toContain("Or create it: giwt new-branch ghost [base]");
  });
});
