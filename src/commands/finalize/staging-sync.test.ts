// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the lazy dev-checkout sync (staging-sync.ts) — the finalize
 * step that reconciles the dev checkout with the CAS-moved target ref.
 *
 * The fixtures reproduce the observed failure shape (BUG-finalize-leaves-
 * dev-worktree-stale-after-merging): the merge lands while the dev
 * checkout is dirty or absent, so index/worktree describe the PRE-move
 * tree against the POST-move HEAD — staged deletions of merge-landed
 * paths, merge-added files missing from disk. Every child git runs with
 * isolatedGitEnv() so ambient GIT_* hook context cannot poison them.
 *
 * The ref move is simulated exactly as the staging merge performs it:
 * snapshot (pre-CAS) → `git update-ref refs/heads/dev <new> <old>` →
 * syncDevLazily. Nothing else in finalize participates in the contract
 * under test (residue classification, targeted restore, refusal).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorktreeConfig } from "../../utils/config";
import { isolatedGitEnv } from "../../utils/git";
import { scratchRoot } from "../../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../../utils/settings";
import { LOCK_FILENAME } from "../abort/helpers";
import { snapshotDevReadiness, syncDevLazily } from "./staging-sync";

let root: string;
let config: WorktreeConfig;
let baseSha: string; // c0 — pre-move dev tip
let tipSha: string; // c1 — the merge result the CAS moves dev to

function git(args: string[], cwd: string = root): string {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (p.exitCode !== 0) throw new Error(`git ${args}: ${p.stderr}`);
  return p.stdout.toString();
}

/** Seed dev @ c0 (keep/mod/del), land the merge-shaped delta on feature @ c1. */
function gitFixture(): void {
  root = mkdtempSync(join(scratchRoot(), "giwt-staging-sync-"));
  git(["init", "-q", "-b", "dev"]);
  git(["config", "user.email", "test@giwt.local"]);
  git(["config", "user.name", "giwt test"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "keep.txt"), "keep\n");
  writeFileSync(join(root, "mod.txt"), "mod v1\n");
  writeFileSync(join(root, "del.txt"), "del\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "seed"]);
  baseSha = git(["rev-parse", "HEAD"]).trim();
  git(["checkout", "-qb", "feature"]);
  writeFileSync(join(root, "mod.txt"), "mod v2\n");
  writeFileSync(join(root, "new.txt"), "new\n");
  git(["rm", "-q", "del.txt"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "merge-shaped delta"]);
  tipSha = git(["rev-parse", "HEAD"]).trim();
  git(["checkout", "-q", "dev"]);
  mkdirSync(resolve(root, "tree"));
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: resolve(root, "tree"),
    settings: DEFAULT_SETTINGS,
    agentGpgKeyId: "ABCDEF0123456789",
    agentGpgName: "test",
    agentGpgEmail: "test@giwt.local",
  };
}

/** Move the dev ref exactly the way the staging merge's CAS does. */
function moveDevRef(): void {
  git(["update-ref", "refs/heads/dev", tipSha, baseSha]);
}

function devStatus(): string {
  return git(["status", "--porcelain"]);
}

/** Staged entries (HEAD → index): the booby-trap detector from the ticket. */
function stagedAgainstHead(): string {
  return git(["diff", "--cached", "--name-status", "HEAD"]);
}

beforeEach(() => {
  gitFixture();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("dev checkout lazy sync (clean fast path)", () => {
  it("syncs a clean dev checkout to the moved ref", () => {
    const readiness = snapshotDevReadiness(config, "dev");
    expect(readiness.onTarget).toBe(true);
    expect(readiness.headSha).toBe(baseSha);
    moveDevRef();
    const result = syncDevLazily(config, "dev", readiness);
    expect(result).toEqual({ synced: true, blocked: false, reason: "" });
    expect(devStatus()).toBe("");
    expect(readFileSync(join(root, "mod.txt"), "utf8")).toBe("mod v2\n");
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("new\n");
    expect(existsSync(join(root, "del.txt"))).toBe(false);
  });

  it("exempts giwt's finalize lock scratch from the dirtiness decision", () => {
    writeFileSync(join(root, LOCK_FILENAME), "");
    const readiness = snapshotDevReadiness(config, "dev");
    expect(readiness.onTarget).toBe(true);
    moveDevRef();
    expect(syncDevLazily(config, "dev", readiness).synced).toBe(true);
  });
});

describe("dev checkout lazy sync (dirty dev, the ticket regression)", () => {
  it("restores merge residue, preserves the user modification, refuses to sync", () => {
    writeFileSync(join(root, "keep.txt"), "user edit\n");
    const readiness = snapshotDevReadiness(config, "dev");
    expect(readiness.onTarget).toBe(false);
    expect(readiness.dirtyPaths.has("keep.txt")).toBe(true);
    moveDevRef();
    const result = syncDevLazily(config, "dev", readiness);
    expect(result.blocked).toBe(true);
    expect(result.synced).toBe(false);
    expect(result.reason).toContain("keep.txt");
    // (a) nothing staged against the moved HEAD — no staged deletion of
    // merge-landed paths
    expect(stagedAgainstHead()).toBe("");
    // (b) merge-landed paths present on disk with merged content
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("new\n");
    expect(readFileSync(join(root, "mod.txt"), "utf8")).toBe("mod v2\n");
    expect(existsSync(join(root, "del.txt"))).toBe(false);
    // (c) the genuine user modification is preserved untouched
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("user edit\n");
    expect(devStatus()).toBe(" M keep.txt\n");
  });

  it("preserves a staged user change instead of resetting it away", () => {
    writeFileSync(join(root, "keep.txt"), "user staged\n");
    git(["add", "keep.txt"]);
    const readiness = snapshotDevReadiness(config, "dev");
    moveDevRef();
    const result = syncDevLazily(config, "dev", readiness);
    expect(result.blocked).toBe(true);
    const staged = stagedAgainstHead();
    expect(staged).toContain("M\tkeep.txt");
    expect(staged).not.toContain("new.txt");
    expect(staged).not.toContain("mod.txt");
    expect(staged).not.toContain("del.txt");
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("user staged\n");
  });

  it("never clobbers an untracked user file at a merge-added path", () => {
    writeFileSync(join(root, "new.txt"), "user file\n");
    const readiness = snapshotDevReadiness(config, "dev");
    expect(readiness.dirtyPaths.has("new.txt")).toBe(true);
    moveDevRef();
    const result = syncDevLazily(config, "dev", readiness);
    expect(result.blocked).toBe(true);
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("user file\n");
    // the residue around it is still restored
    expect(readFileSync(join(root, "mod.txt"), "utf8")).toBe("mod v2\n");
    expect(existsSync(join(root, "del.txt"))).toBe(false);
  });
});

describe("dev checkout lazy sync (checkout not on the target)", () => {
  it("stays informational and touches nothing when dev holds another branch", () => {
    git(["checkout", "-qb", "other"]);
    const readiness = snapshotDevReadiness(config, "dev");
    expect(readiness.onTarget).toBe(false);
    expect(readiness.headBranch).toBe("other");
    moveDevRef();
    const result = syncDevLazily(config, "dev", readiness);
    expect(result).toEqual({ synced: false, blocked: false, reason: "on 'other'" });
    expect(readFileSync(join(root, "mod.txt"), "utf8")).toBe("mod v1\n");
    expect(devStatus()).toBe("");
  });
});

describe("dev checkout lazy sync (targeted residue restore)", () => {
  it("fully syncs a provably clean checkout when the forced checkout is unavailable", () => {
    // Stand-in for the failed fast path: same pre-CAS snapshot, but the
    // restore branch (used when `checkout -f` cannot run) is taken.
    const readiness = snapshotDevReadiness(config, "dev");
    moveDevRef();
    const result = syncDevLazily(config, "dev", { ...readiness, onTarget: false });
    expect(result).toEqual({ synced: true, blocked: false, reason: "" });
    expect(devStatus()).toBe("");
    expect(git(["rev-parse", "HEAD"]).trim()).toBe(tipSha);
    expect(readFileSync(join(root, "mod.txt"), "utf8")).toBe("mod v2\n");
    expect(existsSync(join(root, "del.txt"))).toBe(false);
  });
});

describe("dev checkout lazy sync (unprovable and mid-merge states)", () => {
  it("leaves the checkout alone when the dev ref did not move", () => {
    writeFileSync(join(root, "keep.txt"), "user edit\n");
    const readiness = snapshotDevReadiness(config, "dev");
    // No CAS: the snapshot sha still equals the ref, so there is nothing
    // to sync and the dirt is entirely the user's.
    const result = syncDevLazily(config, "dev", readiness);
    expect(result).toEqual({ synced: false, blocked: false, reason: "dev ref did not move" });
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("user edit\n");
    expect(readFileSync(join(root, "mod.txt"), "utf8")).toBe("mod v1\n");
  });

  it("refuses loudly when the pre-move sha is gone and the delta cannot be computed", () => {
    writeFileSync(join(root, "keep.txt"), "user edit\n");
    const readiness = snapshotDevReadiness(config, "dev");
    moveDevRef();
    // A stale/unknown pre-move sha makes the merge delta uncomputable —
    // safety cannot be proven, so the sync refuses.
    const result = syncDevLazily(config, "dev", { ...readiness, headSha: "0".repeat(40) });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("merge delta unavailable");
  });

  it("refuses when the pre-move HEAD was unresolvable instead of failing open", () => {
    writeFileSync(join(root, "keep.txt"), "user edit\n");
    const readiness = snapshotDevReadiness(config, "dev");
    moveDevRef();
    // An unresolvable pre-state proves nothing: refusing is the only safe
    // answer — never a silent success over a stale checkout.
    const result = syncDevLazily(config, "dev", { ...readiness, headSha: "" });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("dev HEAD unresolvable");
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("user edit\n");
  });

  it("treats a mid-merge edit to a non-delta path as user work", () => {
    const readiness = snapshotDevReadiness(config, "dev");
    moveDevRef();
    // Edited between the snapshot and the sync (mid-merge race): not dirty
    // pre-move and not part of the delta — unexplainable, so user work.
    // Restore branch (fast checkout unavailable), same as a failed -f.
    writeFileSync(join(root, "keep.txt"), "mid-merge edit\n");
    const result = syncDevLazily(config, "dev", { ...readiness, onTarget: false });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("keep.txt");
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("mid-merge edit\n");
  });

  it("never overwrites a mid-merge edit to a merge-delta path", () => {
    const readiness = snapshotDevReadiness(config, "dev");
    moveDevRef();
    // A delta path edited mid-merge no longer matches the pre-move HEAD —
    // the restore must skip it and refuse instead of clobbering it.
    // Restore branch (fast checkout unavailable), same as a failed -f.
    writeFileSync(join(root, "mod.txt"), "mid-merge edit\n");
    const result = syncDevLazily(config, "dev", { ...readiness, onTarget: false });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("mod.txt");
    expect(readFileSync(join(root, "mod.txt"), "utf8")).toBe("mid-merge edit\n");
  });

  it("refuses when the residue restore itself fails", () => {
    const readiness = snapshotDevReadiness(config, "dev");
    moveDevRef();
    // A stale index lock defeats the forced checkout and every restore
    // write: the sync must refuse rather than claim success.
    writeFileSync(join(root, ".git", "index.lock"), "");
    const result = syncDevLazily(config, "dev", { ...readiness, onTarget: false });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("failed to restore merge residue in the dev checkout");
  });
});
