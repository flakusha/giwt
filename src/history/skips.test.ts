// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/history/skips.ts — the durable rebase skip ledger:
 * diff classification, readback, corrupt-line tolerance, and the
 * comparison mode that flags unverifiable drops.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { batchPatchIds, walkRange } from "./patch-ids";
import { diffSkips, readSkips, type SkipRecord, skipsPath, verifySkips } from "./skips";

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

function makeRepo(): { root: string; config: WorktreeConfig; } {
  const root = mkdtempSync(join(scratchRoot(), "giwt-skips-"));
  temps.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "giwt-test@localhost"]);
  git(root, ["config", "user.name", "giwt test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  commit(root, "base.txt", "base");
  const config: WorktreeConfig = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
  return { root, config };
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function record(overrides: Partial<SkipRecord> = {}): SkipRecord {
  return {
    v: 1,
    ts: "2026-10-08T00:00:00.000Z",
    branch: "feature",
    onto: "target",
    preHead: "0".repeat(40),
    sha: "1".repeat(40),
    subject: "skipped work",
    patchId: "2".repeat(40),
    reason: { detected: "duplicate" },
    ...overrides,
  };
}

describe("diffSkips classification", () => {
  test("kept commits match by patch-id; drops classify duplicate vs unexplained", () => {
    const { root } = makeRepo();
    git(root, ["branch", "target"]);
    // Target carries the twin of one feature commit.
    git(root, ["checkout", "-q", "target"]);
    commit(root, "dup.txt", "shared change");
    git(root, ["checkout", "-qb", "feature", "main"]);
    commit(root, "fresh.txt", "fresh work");
    writeFileSync(join(root, "dup.txt"), "shared change\n");
    git(root, ["add", "dup.txt"]);
    git(root, ["commit", "-qm", "shared change again"]);
    commit(root, "mystery.txt", "mystery drop");
    git(root, ["checkout", "-q", "main"]);

    const pre = walkRange({ root, range: "target..feature", noMerges: true });
    // Post-rebase replay kept "fresh work" (new sha) and "shared change
    // again" was skipped; "mystery drop" was dropped without a twin.
    const post = walkRange({ root, range: "target..feature", noMerges: true })
      .filter((c) => c.subject !== "shared change again" && c.subject !== "mystery drop");
    const targetPids = new Map<string, string[]>();
    for (const [sha, pid] of batchPatchIds(root, [git(root, ["rev-parse", "target"]).trim()])) {
      targetPids.set(pid, [sha]);
    }

    const dropped = diffSkips({ pre, post, targetPids });
    expect(dropped.map((d) => d.subject)).toEqual(["shared change again", "mystery drop"]);
    expect(dropped[0]!.reason).toBe("duplicate");
    expect(dropped[0]!.twins).toBeDefined();
    expect(dropped[1]!.reason).toBe("unexplained");
  });

  test("a start-empty commit that survives the replay is not a skip", () => {
    const { root } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "empty marker"]);
    git(root, ["checkout", "-q", "main"]);

    const pre = walkRange({ root, range: "target..feature", noMerges: true });
    // Post replay: same subject survives with a rewritten sha, no patch-id.
    const post = pre.map((c) => ({ ...c, sha: "f".repeat(40) }));
    const dropped = diffSkips({ pre, post, targetPids: new Map() });
    expect(dropped).toHaveLength(0);
  });

  test("a dropped empty commit classifies as empty", () => {
    const { root } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-qb", "feature", "main"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "empty marker"]);
    git(root, ["checkout", "-q", "main"]);

    const pre = walkRange({ root, range: "target..feature", noMerges: true });
    const dropped = diffSkips({ pre, post: [], targetPids: new Map() });
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toBe("empty");
    expect(dropped[0]!.patchId).toBeNull();
  });
});

describe("ledger readback", () => {
  test("records read back in replay (file) order; corrupt lines are skipped", () => {
    const { config } = makeRepo();
    const path = skipsPath(config);
    mkdirSync(dirname(path), { recursive: true });
    const good = record({ subject: "first" });
    const good2 = record({ sha: "3".repeat(40), subject: "second" });
    writeFileSync(
      path,
      `${JSON.stringify(good)}\n{corrupt json\n${JSON.stringify(good2)}\n`,
    );
    const records = readSkips(config);
    expect(records.map((r) => r.subject)).toEqual(["first", "second"]);
  });

  test("missing ledger reads as empty", () => {
    const { config } = makeRepo();
    expect(readSkips(config)).toEqual([]);
  });
});

describe("verifySkips comparison mode", () => {
  test("a duplicate with a verifiable twin in the compared ref is justified", () => {
    const { root } = makeRepo();
    git(root, ["branch", "target"]);
    git(root, ["checkout", "-q", "target"]);
    commit(root, "shared.txt", "shared change");
    const twin = git(root, ["rev-parse", "target"]).trim();
    git(root, ["checkout", "-q", "main"]);
    // A feature commit with the identical patch.
    git(root, ["checkout", "-qb", "feature", "main"]);
    writeFileSync(join(root, "shared.txt"), "shared change\n");
    git(root, ["add", "shared.txt"]);
    git(root, ["commit", "-qm", "shared change again"]);
    const dup = walkRange({ root, range: "main..feature", noMerges: true })[0]!;
    git(root, ["checkout", "-q", "main"]);

    const verdicts = verifySkips({
      root,
      records: [record({ sha: dup.sha, patchId: dup.patchId })],
      vs: "target",
    });
    expect(verdicts[0]!.justified).toBe(true);
    expect(verdicts[0]!.twin).toBe(twin);
  });

  test("a planted non-duplicate is flagged as probable real-work loss", () => {
    const { root } = makeRepo();
    const verdicts = verifySkips({
      root,
      records: [record({ reason: { detected: "unexplained" } })],
      vs: "main",
    });
    expect(verdicts[0]!.justified).toBe(false);
    expect(verdicts[0]!.problem).toContain("probable real-work loss");
  });

  test("an empty skip is justified while its object still diffs empty", () => {
    const { root } = makeRepo();
    git(root, ["checkout", "-qb", "feature", "main"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "empty marker"]);
    const empty = walkRange({ root, range: "main..feature", noMerges: true })[0]!;
    git(root, ["checkout", "-q", "main"]);

    const verdicts = verifySkips({
      root,
      records: [record({ sha: empty.sha, patchId: null, reason: { detected: "empty" } })],
      vs: "main",
    });
    expect(verdicts[0]!.justified).toBe(true);
  });

  test("an empty skip whose object is gone is unverifiable", () => {
    const { root } = makeRepo();
    const verdicts = verifySkips({
      root,
      // Fabricated sha: the object does not exist.
      records: [record({ sha: "e".repeat(40), patchId: null, reason: { detected: "empty" } })],
      vs: "main",
    });
    expect(verdicts[0]!.justified).toBe(false);
    expect(verdicts[0]!.problem).toContain("gone");
  });
});
