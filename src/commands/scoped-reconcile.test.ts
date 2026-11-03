// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the Step 5c staging seam (stagePlanDir).
 *
 * The repo's .gitignore decides which plan paths stay untracked; the
 * reconciliation staging must not re-add them — a repo that retires its
 * generated plan artifacts would otherwise get them back on every
 * finalize.
 *
 * Resource contract (parallel-safe): each test owns a unique mkdtemp git
 * repo torn down in afterEach.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../utils/scratch-tmp";
import { stagePlanDir } from "./scoped-reconcile";

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function git(cwd: string, ...args: string[]): string {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_") || key === "GNUPGHOME") continue;
    if (value !== undefined) env[key] = value;
  }
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function makeRepo(): string {
  root = mkdtempSync(join(scratchRoot(), "giwt-stage-plan-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "giwt-test@example.com");
  git(root, "config", "user.name", "giwt test");
  return root;
}

/** Mirrors the repo convention: dot-directories are re-included so plan
 * files stage with a plain add, then the retired artifacts are ignored. */
function writeGitignore(repo: string, extra = ""): void {
  writeFileSync(join(repo, ".gitignore"), `!.plan/\n!.plan/**\n${extra}`);
}

describe("stagePlanDir", () => {
  test("stages the plan dir but not the paths the repo ignores", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
    writeFileSync(join(repo, ".plan", "tickets", "index.json"), "{}\n");
    writeFileSync(join(repo, ".plan", "code-map.json"), "{}\n");
    writeGitignore(repo, ".plan/code-map.json\n");

    stagePlanDir(repo, ".plan");

    const staged = git(repo, "diff", "--cached", "--name-only");
    expect(staged).toContain(".plan/tickets/index.json");
    expect(staged).not.toContain(".plan/code-map.json");
  });

  test("stages every plan path when the repo ignores none of them", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
    writeFileSync(join(repo, ".plan", "tickets", "index.json"), "{}\n");
    writeFileSync(join(repo, ".plan", "code-map.json"), "{}\n");
    writeGitignore(repo);

    stagePlanDir(repo, ".plan");

    const staged = git(repo, "diff", "--cached", "--name-only");
    expect(staged).toContain(".plan/tickets/index.json");
    expect(staged).toContain(".plan/code-map.json");
  });

  test("ignores the user's global excludesFile (dot-dir hygiene)", () => {
    const repo = makeRepo();
    const globalIgnore = join(repo, "global-ignore");
    writeFileSync(globalIgnore, ".*/\n");
    git(repo, "config", "core.excludesFile", globalIgnore);
    mkdirSync(join(repo, ".plan", "tickets"), { recursive: true });
    writeFileSync(join(repo, ".plan", "tickets", "index.json"), "{}\n");

    stagePlanDir(repo, ".plan");

    const staged = git(repo, "diff", "--cached", "--name-only");
    expect(staged).toContain(".plan/tickets/index.json");
  });
});
