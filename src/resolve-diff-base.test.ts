// SPDX-License-Identifier: AGPL-3.0-or-later
import { scratchRoot } from "./utils/scratch-tmp";
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for resolveDiffBase — the helper that decides which git ref to
 * hand to `bun run check --diff-base` during `worktree finalize` Step 2.
 *
 * Contract (BUG-resolvediffbase-returns-merge-base-instead-of-the-):
 * resolveDiffBase returns the operator's REQUESTED target, not
 * `git merge-base target HEAD`. The merge-base call survives only as
 * fail-closed validation of the target ref.
 *
 * History: the merge-base form was itself a fix — the live target leaked
 * unrelated target-only changes into the scoped diff and the coverage
 * gate applied its floor to modules the branch never touched. But the
 * merge-base mis-scopes in BOTH directions (files the target independently
 * reproduced are over-reported; files the target moved are under-reported)
 * and, being a valid ref, never errors. The requested target is the exact
 * requested scope: every consumer diffs two-dot (`git diff <base>`).
 *
 * Setup strategy: real tiny git histories in mkdtemp fixtures under /tmp/ —
 * they cannot affect the real repo.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveDiffBase } from "./commands/finalize";

let workDir: string;
let baseSha: string;

function run(cmd: string[], cwd: string): string {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    const err = proc.stderr.toString();
    throw new Error("Command failed: " + cmd.join(" ") + " stderr=" + err);
  }
  return proc.stdout.toString().trim();
}

beforeEach(() => {
  workDir = mkdtempSync(join(scratchRoot(), "giwt-resolve-diff-base-"));
  // init, identity, initial commit on master
  run(["git", "init", "--initial-branch=master"], workDir);
  run(["git", "config", "user.email", "test@example.com"], workDir);
  run(["git", "config", "user.name", "Test"], workDir);
  run(["git", "commit", "--allow-empty", "-m", "base"], workDir);
  baseSha = run(["git", "rev-parse", "HEAD"], workDir);

  // create a branch `feature` at base, advance master (the "target")
  run(["git", "checkout", "-b", "feature"], workDir);
  run(["git", "checkout", "master"], workDir);
  run(["git", "commit", "--allow-empty", "-m", "advance-on-target"], workDir);
  run(["git", "checkout", "feature"], workDir);
  // Now: feature HEAD == base, master HEAD is one commit ahead.
  // merge-base(feature, master) should be baseSha, not master's HEAD.
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("resolveDiffBase", () => {
  it("returns the requested target even when it moved past the branch's base", () => {
    // feature HEAD sits on baseSha while master advanced; the helper must
    // still yield the requested target ref, never the merge-base (the
    // merge-base under-reports files the target moved).
    const got = resolveDiffBase(workDir, "master");
    expect(got).toBe("master");
    expect(got).not.toBe(baseSha);
  });

  it("returns the requested target when HEAD == target", () => {
    run(["git", "checkout", "master"], workDir);
    const got = resolveDiffBase(workDir, "master");
    expect(got).toBe("master");
  });

  it("throws when the target is not a valid ref", () => {
    // Fail-closed validation: the merge-base call is retained purely to
    // reject invalid refs; without it an invalid target would flow into
    // the check runner and crash downstream with a confusing stack trace.
    const orphanDir = mkdtempSync(join(scratchRoot(), "giwt-orphan-"));
    try {
      run(["git", "init", "--initial-branch=main"], orphanDir);
      run(["git", "config", "user.email", "test@example.com"], orphanDir);
      run(["git", "config", "user.name", "Test"], orphanDir);
      run(["git", "commit", "--allow-empty", "-m", "lonely"], orphanDir);
      expect(() => resolveDiffBase(orphanDir, "does-not-exist")).toThrow(
        /merge-base/,
      );
    } finally {
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });

  it("pinning two-directional divergence: target scope vs merge-base scope", () => {
    // AC: a test pins BOTH mis-scopes the merge-base introduced, and that
    // the helper now selects the requested target's scope instead.
    //  - under-report: target moved/added fileA — absent from the
    //    merge-base scope, present in the target scope.
    //  - over-report: fileC's content was independently reproduced on the
    //    target — present in the merge-base scope, absent from the target
    //    scope (identical trees cancel in a two-dot diff).
    const dir = mkdtempSync(join(scratchRoot(), "giwt-diffbase-divergence-"));
    try {
      run(["git", "init", "--initial-branch=master"], dir);
      run(["git", "config", "user.email", "test@example.com"], dir);
      run(["git", "config", "user.name", "Test"], dir);
      run(["git", "commit", "--allow-empty", "-m", "base"], dir);
      run(["git", "checkout", "-b", "feature"], dir);
      writeFileSync(join(dir, "fileB"), "b\n");
      writeFileSync(join(dir, "fileC"), "shared\n");
      run(["git", "add", "fileB", "fileC"], dir);
      run(["git", "commit", "-m", "branch work"], dir);
      run(["git", "checkout", "master"], dir);
      writeFileSync(join(dir, "fileA"), "a\n");
      writeFileSync(join(dir, "fileC"), "shared\n");
      run(["git", "add", "fileA", "fileC"], dir);
      run(["git", "commit", "-m", "target work"], dir);
      run(["git", "checkout", "feature"], dir);

      const mergeBase = run(["git", "merge-base", "master", "HEAD"], dir);
      const mbScope = run(["git", "diff", "--name-only", mergeBase, "HEAD"], dir)
        .split("\n").sort();
      const targetScope = run(["git", "diff", "--name-only", "master", "HEAD"], dir)
        .split("\n").sort();

      expect(mbScope).toEqual(["fileB", "fileC"]);
      expect(targetScope).toEqual(["fileA", "fileB"]);
      // Under-report: the target-side change the merge-base scope misses.
      expect(targetScope).toContain("fileA");
      expect(mbScope).not.toContain("fileA");
      // Over-report: independently reproduced content the merge-base scope
      // carries but the requested-target scope cancels.
      expect(mbScope).toContain("fileC");
      expect(targetScope).not.toContain("fileC");
      // The fix: the helper selects the requested target's scope.
      expect(resolveDiffBase(dir, "master")).toBe("master");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
