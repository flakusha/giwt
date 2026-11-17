// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});
