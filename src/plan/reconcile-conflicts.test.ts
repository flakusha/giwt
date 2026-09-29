// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import {
  isAncestorOf,
  mergeIndexRecords,
  rebaseWithPlanReconciliation,
} from "./reconcile-conflicts";

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

/** Base-commit ticket index. `null` commits NO index at the merge base, so a
 *  two-sided add lands as an add/add conflict (git records no stage 1). */
const BASE_INDEX = {
  "TASK-ONE": { status: "open", tags: ["base"] },
  "TASK-TWO": { status: "open", tags: ["base"] },
};

function fixture(ticketsPath = ".plan/tickets", baseIndex: unknown = BASE_INDEX): Fixture {
  const root = mkdtempSync(join(tmpdir(), "giwt-plan-reconcile-"));
  const cleanup = (): void => rmSync(root, { recursive: true, force: true });
  try {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "giwt-test@example.com");
    git(root, "config", "user.name", "giwt test");
    git(root, "config", "commit.gpgsign", "false");
    if (baseIndex !== null) writeJson(root, `${ticketsPath}/index.json`, baseIndex);
    writeFileSync(join(root, "README.md"), "fixture\n");
    if (baseIndex !== null) git(root, "add", "-f", `${ticketsPath}/index.json`);
    git(root, "add", "-f", "README.md");
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

describe("isAncestorOf", () => {
  test("true when the ancestor is already contained", () => {
    const fixtureValue = fixture();
    const { root } = fixtureValue;
    try {
      const base = git(root, "rev-parse", "main~1").trim();
      expect(isAncestorOf(root, base, "HEAD")).toBe(true);
    } finally {
      fixtureValue.cleanup();
    }
  });

  test("false for diverged refs", () => {
    const fixtureValue = fixture();
    const { root } = fixtureValue;
    try {
      expect(isAncestorOf(root, "main", "feature")).toBe(false);
    } finally {
      fixtureValue.cleanup();
    }
  });

  test("false for an unknown ref rather than claiming success", () => {
    const fixtureValue = fixture();
    const { root } = fixtureValue;
    try {
      expect(isAncestorOf(root, "no-such-branch", "HEAD")).toBe(false);
    } finally {
      fixtureValue.cleanup();
    }
  });
});

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

test("unions both sides when the index was added on each branch (no merge-base stage)", () => {
  // Add/add: git records stages 2 and 3 only, so `git show :1:` fails and the
  // merge base contributes nothing. Both sides' tickets must survive.
  const fixtureValue = fixture(".plan/tickets", null);
  const { root } = fixtureValue;
  try {
    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([".plan/tickets/index.json"]);
    // Neither side's edits may be dropped by the missing base: `ours` is the
    // commit being replayed (feature), so its ticket keeps status=done while
    // main's ticket is unioned in alongside it.
    expect(JSON.parse(readFileSync(join(root, ".plan/tickets/index.json"), "utf8"))).toEqual({
      "TASK-ONE": { status: "closed", tags: ["base", "main", "feature"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    fixtureValue.cleanup();
  }
});

test("names the field when all three index stages disagree on it", () => {
  // base=open, ours=done, theirs=closed: no pair matches the base, so the
  // field cannot be auto-merged and must be reported by name.
  const result = mergeIndexRecords(
    { "TASK-ONE": { status: "open" }, "TASK-TWO": { status: "open" } },
    { "TASK-ONE": { status: "done" }, "TASK-TWO": { status: "open" } },
    { "TASK-ONE": { status: "closed" }, "TASK-TWO": { status: "open" } },
  );
  expect(result.conflicts).toEqual(["index.TASK-ONE.status"]);
  // Uncontested fields on the same ticket still merge.
  expect(result.value).toEqual({
    "TASK-ONE": { status: "done" },
    "TASK-TWO": { status: "open" },
  });
});

test("regenerates the epic docs when a generated conflict is resolved", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    // Rewind feature to the merge base and re-stack its commits, so the epics
    // dir is in the worktree by the time the index conflict is resolved (the
    // epics docs are generated from what regenerate() can see on disk).
    git(root, "reset", "--hard", git(root, "rev-parse", "main~1").trim());
    const epic = [
      "# EPIC: Alpha",
      "",
      "**Status:** in-progress",
      "**Priority:** high",
      "**Effort:** 3",
      "**Type:** feature",
      "**Tags:** core, alpha",
      "",
      "## Overview",
      "",
      "The alpha epic body.",
      "",
      "- [ ] TASK-ONE work",
      "",
    ].join("\n");
    mkdirSync(join(root, ".plan/epics"), { recursive: true });
    writeFileSync(join(root, ".plan/epics/epic-alpha.md"), epic);
    git(root, "add", "-f", ".plan/epics/epic-alpha.md");
    git(root, "commit", "-qm", "add epic");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature index");

    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    // genDocs runs on the regeneration path: the epics index must carry the
    // epic's parsed metadata out of the source tree, not just its filename.
    const index = readFileSync(join(root, ".plan/epics-index.md"), "utf8");
    expect(index).toContain("**Total:** 1 epics");
    expect(index).toContain("| in-progress | Alpha | high | 3 | 1 |");
    expect(index).toContain("**Tags:** core, alpha");
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    fixtureValue.cleanup();
  }
});

test("does not auto-resolve when a source file conflicts alongside a generated one", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    // ONE commit per side that touches both a generated and a human file. The
    // rewind makes this the FIRST commit the rebase replays, so the very first
    // conflict set spans a human file and a generated one together — a human
    // must resolve, and giwt must not clobber the generated file.
    git(root, "reset", "--hard", git(root, "rev-parse", "main~1").trim());
    writeFileSync(join(root, "README.md"), "feature side\n");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", "README.md", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature touches both");
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, "README.md"), "main side\n");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "closed", tags: ["base", "main"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    git(root, "add", "-f", "README.md", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "main touches both");
    git(root, "checkout", "-q", "feature");

    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).not.toBe(0);
    // Nothing was auto-resolved: both paths are still unmerged in the index.
    const unmerged = git(root, "diff", "--name-only", "--diff-filter=U");
    expect(unmerged).toContain("README.md");
    expect(unmerged).toContain(".plan/tickets/index.json");
    expect(git(root, "ls-files", "-u")).toContain(".plan/tickets/index.json");
  } finally {
    fixtureValue.cleanup();
  }
});
