// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { mergeIndexRecords, rebaseWithPlanReconciliation } from "./reconcile-conflicts";

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedGitEnv(), GIT_EDITOR: "true" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${
        args.join(" ")
      } failed (${result.exitCode}): ${result.stderr.toString()} ${result.stdout.toString()}`,
    );
  }
  return result.stdout.toString();
}

function writeJson(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

interface Fixture {
  root: string;
  branch: string;
  cleanup: () => void;
}

function fixture(ticketsPath = ".plan/tickets"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-plan-reconcile-"));
  const cleanup = (): void => rmSync(root, { recursive: true, force: true });
  try {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "giwt-test@example.com");
    git(root, "config", "user.name", "giwt test");
    git(root, "config", "commit.gpgsign", "false");
    writeJson(root, `${ticketsPath}/index.json`, {
      "TASK-ONE": { status: "open", tags: ["base"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    writeFileSync(join(root, "README.md"), "fixture\n");
    git(root, "add", "-f", `${ticketsPath}/index.json`, "README.md");
    git(root, "commit", "-qm", "base");
    git(root, "checkout", "-qb", "feature");
    writeJson(root, `${ticketsPath}/index.json`, {
      "TASK-ONE": { status: "done", tags: ["base", "feature"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", `${ticketsPath}/index.json`);
    git(root, "commit", "-qm", "feature");
    git(root, "checkout", "-q", "main");
    writeJson(root, `${ticketsPath}/index.json`, {
      "TASK-ONE": { status: "closed", tags: ["base", "main"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    git(root, "add", "-f", `${ticketsPath}/index.json`);
    git(root, "commit", "-qm", "main");
    git(root, "checkout", "-q", "feature");
    return { root, branch: "feature", cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

describe("mergeIndexRecords", () => {
  test("unions records and field changes", () => {
    const result = mergeIndexRecords(
      { "TASK-ONE": { status: "open" }, "TASK-TWO": { status: "open" } },
      { "TASK-ONE": { status: "done" }, "TASK-TWO": { status: "open" } },
      { "TASK-ONE": { status: "open" }, "TASK-TWO": { status: "closed" } },
    );
    expect(result.value).toEqual({
      "TASK-ONE": { status: "done" },
      "TASK-TWO": { status: "closed" },
    });
    expect(result.conflicts).toEqual([]);
  });
});

test("resolves generated conflicts across successive rebase commits", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    git(root, "checkout", "-q", "main");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "closed", tags: ["base", "main-one"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "main one");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "closed", tags: ["base", "main-one"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main-two"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "main two");
    git(root, "checkout", "-q", "feature");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature-one"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature one");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature-one"] },
      "TASK-TWO": { status: "done", tags: ["base", "feature-two"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature two");

    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([
      ".plan/tickets/index.json",
      ".plan/tickets/index.json",
      ".plan/tickets/index.json",
    ]);
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    fixtureValue.cleanup();
  }
});

test("stops when source files conflict with generated files", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    writeFileSync(join(root, "README.md"), "feature source\n");
    git(root, "add", "README.md");
    git(root, "commit", "-qm", "feature source");
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, "README.md"), "main source\n");
    git(root, "add", "README.md");
    git(root, "commit", "-qm", "main source");
    git(root, "checkout", "-q", "feature");
    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).not.toBe(0);
    expect(git(root, "diff", "--name-only", "--diff-filter=U")).toContain("README.md");
    expect(git(root, "status", "--porcelain")).toContain("README.md");
  } finally {
    fixtureValue.cleanup();
  }
});

test("uses configured plan and ticket paths", () => {
  const fixtureValue = fixture(".planning/issues");
  const { root } = fixtureValue;
  try {
    const result = rebaseWithPlanReconciliation(root, "main", ".planning", ".planning/issues");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([".planning/issues/index.json"]);
  } finally {
    fixtureValue.cleanup();
  }
});

test("rebase resolves generated plan conflicts and regenerates derived files", () => {
  const fixtureValue = fixture();
  const { root, branch } = fixtureValue;
  try {
    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([".plan/tickets/index.json"]);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(JSON.parse(readFileSync(join(root, ".plan/tickets/index.json"), "utf8"))).toEqual({
      "TASK-ONE": { status: "closed", tags: ["base", "main", "feature"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    expect(readFileSync(join(root, ".plan/feature-matrix.md"), "utf8")).toContain(
      "Total tickets: **2**",
    );
    expect(readFileSync(join(root, ".plan/code-map.json"), "utf8")).toBe("{}\n");
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(branch);
  } finally {
    fixtureValue.cleanup();
  }
});
