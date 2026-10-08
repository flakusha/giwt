// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/history/audit.ts — shape classification and the two
 * built-in detectors. Every test owns a mkdtemp git repo; commits carry
 * a fixture-local identity (no global config touched).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { auditHistory } from "./audit";
import { walkRange } from "./patch-ids";

const temps: string[] = [];

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function commit(root: string, path: string, message: string): void {
  writeFileSync(join(root, path), `${message}\n`);
  git(root, ["add", path]);
  git(root, ["commit", "-qm", message]);
}

function makeRepo(): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-audit-"));
  temps.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "giwt-test@localhost"]);
  git(root, ["config", "user.name", "giwt test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  commit(root, "base.txt", "base");
  return root;
}

const DEFAULTS = { linearity: "auto", patchIds: true, maxFindings: 200 } as const;

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("auditHistory shape", () => {
  test("linear range over a linear target: clean, verdict linear", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature"]);
    commit(root, "feat.txt", "fresh work");
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({ root, branch: "feature", onto: "target", ...DEFAULTS });
    expect(report.shape.linear).toBe(true);
    expect(report.shape.merges).toBe(0);
    expect(report.shape.octopus).toBe(0);
    expect(report.shape.crissCross).toBe(false);
    expect(report.shape.effective).toBe("require-linear");
    expect(report.shape.verdict).toBe("linear");
    expect(report.findings).toEqual({});
    expect(report.exit).toBe(0);
  });

  test("merge in range with require-linear: merge-in-range findings gate the rebase", () => {
    const root = makeRepo();
    git(root, ["checkout", "-qb", "side"]);
    commit(root, "side.txt", "side work");
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "feat.txt", "fresh work");
    git(root, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({ root, branch: "feature", onto: "main", ...DEFAULTS });
    expect(report.shape.linear).toBe(false);
    expect(report.shape.merges).toBe(1);
    expect(report.shape.verdict).toBe("merge-violation");
    expect(report.findings["merge-in-range"]).toHaveLength(1);
    expect(report.findings["merge-in-range"]![0]!.subject).toBe("merge side");
    expect(report.exit).toBe(1);
  });

  test("allow-merges walks both sides without flagging the merge", () => {
    const root = makeRepo();
    git(root, ["checkout", "-qb", "side"]);
    commit(root, "side.txt", "side work");
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "feat.txt", "fresh work");
    git(root, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({
      root,
      branch: "feature",
      onto: "main",
      ...DEFAULTS,
      linearity: "allow-merges",
    });
    expect(report.shape.verdict).toBe("merges-allowed");
    // Both sides of the merge are in the inventory (commits counted).
    expect(report.shape.commits).toBe(3);
    expect(report.findings["merge-in-range"]).toBeUndefined();
    expect(report.exit).toBe(0);
  });

  test("auto against a merge-carrying target allows merges", () => {
    const root = makeRepo();
    git(root, ["checkout", "-qb", "target-side"]);
    commit(root, "ts.txt", "target side");
    git(root, ["checkout", "-q", "main"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "target merge", "target-side"]);
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "target"]);
    commit(root, "feat.txt", "fresh work");
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({ root, branch: "feature", onto: "target", ...DEFAULTS });
    expect(report.shape.effective).toBe("allow-merges");
    expect(report.shape.verdict).toBe("linear");
    expect(report.exit).toBe(0);
  });

  test("octopus merge is counted separately", () => {
    const root = makeRepo();
    for (const name of ["x1", "y1", "z1"]) {
      git(root, ["branch", name]);
    }
    git(root, ["checkout", "-q", "x1"]);
    commit(root, "x.txt", "x work");
    git(root, ["checkout", "-q", "y1"]);
    commit(root, "y.txt", "y work");
    git(root, ["checkout", "-q", "z1"]);
    commit(root, "z.txt", "z work");
    git(root, ["checkout", "-q", "main"]);
    git(root, ["checkout", "-q", "x1"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "octopus", "y1", "z1"]);
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({ root, branch: "x1", onto: "main", ...DEFAULTS });
    expect(report.shape.merges).toBe(1);
    expect(report.shape.octopus).toBe(1);
  });

  test("criss-cross history reports multiple merge bases", () => {
    const root = makeRepo();
    git(root, ["branch", "a"]);
    git(root, ["branch", "b"]);
    git(root, ["checkout", "-q", "a"]);
    commit(root, "a.txt", "a1");
    git(root, ["checkout", "-q", "b"]);
    commit(root, "b.txt", "b1");
    const a1 = git(root, ["rev-parse", "a"]).trim();
    // Cross: a merges b; b merges a's ORIGINAL tip (not the merge).
    git(root, ["checkout", "-q", "a"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "a merges b", "b"]);
    git(root, ["checkout", "-q", "b"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "b merges a", a1]);
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({ root, branch: "a", onto: "b", ...DEFAULTS });
    expect(report.shape.mergeBases).toHaveLength(2);
    expect(report.shape.crissCross).toBe(true);
  });
});

describe("auditHistory detectors", () => {
  test("duplicate-patch-id flags an upstream-identical change with its twin as evidence", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    commit(root, "shared.txt", "shared change");
    const twin = git(root, ["rev-parse", "target"]).trim();
    git(root, ["checkout", "-qb", "feature", "main"]);
    // Same change on the feature side: identical patch, different commit.
    writeFileSync(join(root, "shared.txt"), "shared change\n");
    git(root, ["add", "shared.txt"]);
    git(root, ["commit", "-qm", "shared change again"]);
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({ root, branch: "feature", onto: "target", ...DEFAULTS });
    const findings = report.findings["duplicate-patch-id"]!;
    expect(findings).toHaveLength(1);
    expect(findings[0]!.twins).toContain(twin);
    expect(findings[0]!.patchId).toMatch(/^[0-9a-f]{40}$/);
    expect(findings[0]!.evidence).toContain(twin.slice(0, 7));
    expect(report.exit).toBe(1);
  });

  test("patch_ids=false disables duplicate detection but keeps empties", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    commit(root, "shared.txt", "shared change");
    git(root, ["checkout", "-qb", "feature", "main"]);
    writeFileSync(join(root, "shared.txt"), "shared change\n");
    git(root, ["add", "shared.txt"]);
    git(root, ["commit", "-qm", "shared change again"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "empty marker"]);
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({
      root,
      branch: "feature",
      onto: "target",
      ...DEFAULTS,
      patchIds: false,
    });
    expect(report.findings["duplicate-patch-id"]).toBeUndefined();
    expect(report.findings["empty-commit"]).toHaveLength(1);
    expect(report.exit).toBe(1);
  });

  test("empty-commit flags a no-diff commit", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "empty marker"]);
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({ root, branch: "feature", onto: "target", ...DEFAULTS });
    expect(report.findings["empty-commit"]![0]!.subject).toBe("empty marker");
    expect(report.exit).toBe(1);
  });

  test("findings cap records findingsTotal instead of truncating silently", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    for (let i = 1; i <= 3; i++) {
      git(root, ["commit", "-q", "--allow-empty", "-m", `empty ${i}`]);
    }
    git(root, ["checkout", "-q", "main"]);

    const report = auditHistory({
      root,
      branch: "feature",
      onto: "target",
      ...DEFAULTS,
      maxFindings: 2,
    });
    expect(report.findings["empty-commit"]).toHaveLength(2);
    expect(report.findingsTotal).toBe(3);
    expect(report.exit).toBe(1);
  });

  test("unknown refs throw instead of auditing garbage", () => {
    const root = makeRepo();
    expect(() => auditHistory({ root, branch: "nope", onto: "main", ...DEFAULTS })).toThrow();
  });
});

describe("walkRange", () => {
  test("walks replay order (oldest first) with parents and patch-ids", () => {
    const root = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "one.txt", "c one");
    commit(root, "two.txt", "c two");
    git(root, ["checkout", "-q", "main"]);

    const commits = walkRange({ root, range: "target..feature" });
    expect(commits.map((c) => c.subject)).toEqual(["c one", "c two"]);
    expect(commits[0]!.parents).toHaveLength(1);
    expect(commits[0]!.patchId).toMatch(/^[0-9a-f]{40}$/);
  });
});
