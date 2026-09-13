// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for resolveDiffBase — the helper that decides which git ref to
 * hand to `bun run check --diff-base` during `worktree finalize` Step 2.
 *
 * Regression target: previously finalize passed the live target branch
 * (e.g. `dev`) as the diff-base. When the target had moved past the
 * finalizing branch's base, the scoped diff included files the branch
 * never touched — and the coverage gate applied its 80% floor to those
 * unrelated modules. Fix: pass the merge-base so the diff is exactly
 * the branch's own contribution since forking from the target.
 *
 * Setup strategy: build a real tiny git history with a shared base
 * commit, then advance one branch (the "target") past the base while
 * leaving the "HEAD" branch untouched. Asserting on the resolved ref
 * proves the helper picks the stable ancestor instead of the moving
 * target. The fixture runs against /tmp/ so it cannot affect the
 * real repo.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  workDir = mkdtempSync(join(tmpdir(), "giwt-resolve-diff-base-"));
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
  it("returns the merge-base when the target has moved past the branch's base", () => {
    // from `feature` HEAD, the diff vs `master` should be empty —
    // so resolveDiffBase must yield the stable ancestor (baseSha),
    // not master's advanced HEAD.
    const got = resolveDiffBase(workDir, "master");
    expect(got).toBe(baseSha);
  });

  it("returns the merge-base matching the target HEAD when HEAD == target", () => {
    // from `master` HEAD, no work on top → merge-base == master HEAD.
    run(["git", "checkout", "master"], workDir);
    const masterHead = run(["git", "rev-parse", "HEAD"], workDir);
    const got = resolveDiffBase(workDir, "master");
    expect(got).toBe(masterHead);
  });

  it("throws when the target is not a valid ref", () => {
    // Strict-mode regression: the previous implementation silently
    // returned the invalid `target`, which crashed the check runner
    // downstream with a confusing stack trace at changedFiles().
    // Production callers always pass a valid ref, so this throw is
    // unreachable in finalize flows but defensive against bad input.
    const orphanDir = mkdtempSync(join(tmpdir(), "giwt-orphan-"));
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
});
