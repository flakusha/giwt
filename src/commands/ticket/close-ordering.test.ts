// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { closeTickets } from "./close";

// Resource contract: each test owns one mkdtemp scratch repo (no fixed paths,
// no cwd/env mutation) and removes it in afterEach — parallel-safe.
const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

describe.skipIf(Bun.which("git-issue") === null)("ticket close ordering", () => {
  it("leaves the .md untouched when the git issue close fails", async () => {
    const dir = mkdtempSync(join(scratchRoot(), "giwt-close-order-"));
    temps.push(dir);
    const repo = join(dir, "proj");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "giwt-test@localhost");
    git(repo, "config", "user.name", "giwt test");

    const rel = ".plan/tickets/TASK-close-fail.md";
    mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
    writeFileSync(
      join(repo, rel),
      "# TASK: close fail\n\n**Status:** In Progress\n\nbody\n",
    );
    const index = {
      "TASK-CLOSE-FAIL": {
        hash: "pending",
        git_issue: "fffffff",
        extid: "TASK-CLOSE-FAIL",
        type: "TASK",
        title: "close fail",
        label: "task",
        priority: "medium",
        epic: "",
        project: "",
        tags: [],
        source: rel,
        status: "open",
      },
    };
    writeFileSync(
      join(repo, ".plan", "tickets", "index.json"),
      `${JSON.stringify(index, null, 2)}\n`,
    );

    const config: WorktreeConfig = {
      repoRoot: repo,
      worktreeRoot: repo,
      treeDir: repo,
      settings: DEFAULT_SETTINGS,
    };
    await expect(closeTickets(["TASK-CLOSE-FAIL"], config)).rejects.toThrow();

    const md = readFileSync(join(repo, rel), "utf8");
    expect(md).toContain("**Status:** In Progress");
    expect(md).not.toContain("**Resolved:**");
  });

  it("rewrites only the successfully closed .md when a later issue close fails", async () => {
    const dir = mkdtempSync(join(scratchRoot(), "giwt-close-partial-"));
    temps.push(dir);
    const repo = join(dir, "proj");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "giwt-test@localhost");
    git(repo, "config", "user.name", "giwt test");

    const okRel = ".plan/tickets/TASK-close-ok.md";
    const badRel = ".plan/tickets/TASK-close-bad.md";
    const okHash = "1111111";
    const badHash = "2222222";
    mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
    writeFileSync(join(repo, okRel), "# TASK: close ok\n\n**Status:** In Progress\n\nbody\n");
    writeFileSync(join(repo, badRel), "# TASK: close bad\n\n**Status:** In Progress\n\nbody\n");

    const entry = (extid: string, title: string, source: string, gitIssue: string) => ({
      hash: "pending",
      git_issue: gitIssue,
      extid,
      type: "TASK",
      title,
      label: "task",
      priority: "medium",
      epic: "",
      project: "",
      tags: [],
      source,
      status: "open",
    });
    const index = {
      "TASK-CLOSE-OK": entry("TASK-CLOSE-OK", "close ok", okRel, okHash),
      "TASK-CLOSE-BAD": entry("TASK-CLOSE-BAD", "close bad", badRel, badHash),
    };
    writeFileSync(
      join(repo, ".plan", "tickets", "index.json"),
      `${JSON.stringify(index, null, 2)}\n`,
    );

    // PATH shim: exit 1 for the second ticket's hash, success otherwise.
    // Hashes are explicit in the index, so closeTickets' only git call is the
    // issue-state close — no real git-issue registry is needed.
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const shim = join(bin, "git");
    writeFileSync(
      shim,
      `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "${badHash}" ]; then exit 1; fi\ndone\nexit 0\n`,
    );
    chmodSync(shim, 0o755);

    const config: WorktreeConfig = {
      repoRoot: repo,
      worktreeRoot: repo,
      treeDir: repo,
      settings: DEFAULT_SETTINGS,
    };
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath ?? ""}`;
    try {
      await expect(closeTickets(["TASK-CLOSE-OK", "TASK-CLOSE-BAD"], config))
        .rejects.toThrow();
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
    }

    const okMd = readFileSync(join(repo, okRel), "utf8");
    expect(okMd).toContain("**Status:** Done");
    expect(okMd).toContain("**Resolved:**");

    const badMd = readFileSync(join(repo, badRel), "utf8");
    expect(badMd).toContain("**Status:** In Progress");
    expect(badMd).not.toContain("**Resolved:**");
  });
});
