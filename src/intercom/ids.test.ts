// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Project identity keying: URL normalization, slugs, path fallback, and
 * worktree-consistent identities (fixture repos, no remotes → path keys;
 * a remote.origin.url fixture exercises the URL rule).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { normalizeRemoteUrl, projectIdentity, slugify } from "./ids";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRepo(remote?: string): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-intercom-ids-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root], { env: isolatedGitEnv() });
  execFileSync("git", ["-C", root, "config", "user.email", "giwt-test@localhost"], {
    env: isolatedGitEnv(),
  });
  execFileSync("git", ["-C", root, "config", "user.name", "giwt test"], {
    env: isolatedGitEnv(),
  });
  if (remote !== undefined) {
    execFileSync("git", ["-C", root, "config", "remote.origin.url", remote], {
      env: isolatedGitEnv(),
    });
  }
  return root;
}

describe("normalizeRemoteUrl", () => {
  it("strips credentials from every remote dialect", () => {
    expect(normalizeRemoteUrl("git@github.com:owner/repo.git")).toBe("ssh://github.com/owner/repo");
    expect(normalizeRemoteUrl("https://user:pass@github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
    expect(normalizeRemoteUrl("ssh://git@host.com:2222/owner/repo")).toBe(
      "ssh://host.com:2222/owner/repo",
    );
    expect(normalizeRemoteUrl("/srv/git/repo.git/")).toBe("/srv/git/repo");
  });
});

describe("slugify", () => {
  it("keeps filename-safe characters and caps length", () => {
    expect(slugify("My Weird Repo!")).toBe("my-weird-repo");
    expect(slugify("giwt")).toBe("giwt");
    expect(slugify("///")).toBe("repo");
    expect(slugify("x".repeat(100)).length).toBe(40);
  });
});

describe("projectIdentity", () => {
  it("keys path-less repos on the common-dir realpath with a dir-name slug", () => {
    const root = makeRepo();
    const id = projectIdentity(root);
    expect(id.kind).toBe("path");
    expect(id.key.startsWith("path:")).toBe(true);
    expect(id.repoPath).toBe(join(root, ".git"));
    expect(id.dirName).toMatch(new RegExp(`^${id.slug}-[0-9a-f]{16}$`));
  });

  it("keys repos with a remote on the normalized URL", () => {
    const root = makeRepo("git@github.com:owner/Giwt-Repo.git");
    const id = projectIdentity(root);
    expect(id.kind).toBe("url");
    expect(id.key).toBe("ssh://github.com/owner/Giwt-Repo");
    expect(id.slug).toBe("giwt-repo");
    expect(id.dirName).toBe(`giwt-repo-${id.hash.slice(0, 16)}`);
  });

  it("gives worktrees the same identity as the root checkout", () => {
    const root = makeRepo();
    execFileSync("git", ["-C", root, "commit", "--allow-empty", "-qm", "init"], {
      env: isolatedGitEnv(),
    });
    const wt = join(root, "tree", "lane-x");
    mkdirSync(wt, { recursive: true });
    execFileSync("git", ["-C", root, "worktree", "add", "-q", wt, "-b", "lane-x"], {
      env: isolatedGitEnv(),
    });
    tempRoots.push(wt);
    expect(projectIdentity(wt)).toEqual(projectIdentity(root));
  });

  it("produces stable dir names across calls", () => {
    const root = makeRepo();
    expect(projectIdentity(root).dirName).toBe(projectIdentity(root).dirName);
  });
});
