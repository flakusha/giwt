// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the rename-insensitive commit fingerprint. Fixtures are real
 * scratch repos (mkdtemp under the giwt scratch root, removed in finally);
 * every child git runs with isolatedGitEnv() so ambient GIT_* hook context
 * cannot poison them.
 *
 * The regression fixture reproduces the loop-lore shape exactly:
 *   master:  A adds migrations/040_messages_idempotency_unique.ts
 *            B renames it to 045_… (R097 — the docblock changed)
 *   topic:   C re-adds 040_… with the identical diff — asserted to carry
 *            the SAME stable patch-id as A — so a rename sits between the
 *            two copies and patch-id dedup is defeated. The fingerprint
 * must still match them.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { parseDiffTree } from "./diff-tree";
import { commitFingerprint, duplicateCommitFinding, findAppliedDuplicates } from "./fingerprint";

function git(root: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr}`);
  return proc.stdout.toString();
}

function makeRepo(): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-fingerprint-"));
  git(root, ["init", "-q", "-b", "master", "."]);
  git(root, ["config", "user.email", "giwt-test@localhost"]);
  git(root, ["config", "user.name", "giwt test"]);
  return root;
}

function commitAll(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function write(root: string, rel: string, text: string): void {
  writeFileSync(join(root, rel), text);
}

const MIGRATION_040 = `// Migration: 040_messages_idempotency_unique
CREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);
`;

/** Stable patch-id of a commit's diff — used ONLY to assert fixture
 * fidelity (the twin carries the same patch-id git failed to dedup). */
async function stablePatchId(root: string, sha: string): Promise<string> {
  const diff = git(root, ["diff", `${sha}^`, sha]);
  const proc = Bun.spawn(["git", "-C", root, "patch-id", "--stable"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: isolatedGitEnv(),
  });
  proc.stdin.write(diff);
  await proc.stdin.end();
  return ((await new Response(proc.stdout).text()).split(" ")[0]) ?? "";
}

describe("parseDiffTree", () => {
  it("parses A/M/D lines and throws on anything unparseable", () => {
    const entries = parseDiffTree(
      ":000000 100644 0000000000000000000000000000000000000000 aa111111111111111111111111111111111111aa A\tone.ts\n"
        + ":100644 100644 bb222222222222222222222222222222222222bb aa111111111111111111111111111111111111aa M\ttwo.ts\n"
        + ":100644 000000 cc333333333333333333333333333333333333cc 0000000000000000000000000000000000000000 D\tthree.ts\n",
    );
    expect(entries).toEqual([
      { blob: "aa111111111111111111111111111111111111aa", kind: "A", path: "one.ts" },
      { blob: "aa111111111111111111111111111111111111aa", kind: "M", path: "two.ts" },
      { blob: "cc333333333333333333333333333333333333cc", kind: "D", path: "three.ts" },
    ]);
    expect(() => parseDiffTree("garbage line\n")).toThrow("unparseable diff-tree");
    expect(() => parseDiffTree(":100644 100644 aa aa R100\trenamed\n")).toThrow(
      "unsupported diff status",
    );
  });
});

describe("commitFingerprint", () => {
  it("normalizes a commit to path-free (blob, kind) entries", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      commitAll(root, "base");
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_x.ts", MIGRATION_040);
      const sha = commitAll(root, "add 040");
      const fp = commitFingerprint({ repoRoot: root, revision: sha });
      expect(fp.sha).toBe(sha);
      expect(fp.entries).toHaveLength(1);
      expect(fp.entries[0]?.kind).toBe("A");
      expect(fp.entries[0]?.path).toBe("migrations/040_x.ts");
      const blob = git(root, ["hash-object", "migrations/040_x.ts"]).trim();
      expect(fp.entries[0]?.blob).toBe(blob);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("splits a rename into A+D with --no-renames so paths drop out", () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "add 040");
      git(root, ["mv", "migrations/040_x.ts", "migrations/045_x.ts"]);
      write(root, "migrations/045_x.ts", "// Migration: 045_x\nCREATE UNIQUE INDEX uq2 ON m(k);\n");
      const sha = commitAll(root, "rename 040->045");
      const entries = commitFingerprint({ repoRoot: root, revision: sha }).entries;
      expect(entries.map((e) => e.kind).sort()).toEqual(["A", "D"]);
      expect(entries.find((e) => e.kind === "D")?.path).toBe("migrations/040_x.ts");
      expect(entries.find((e) => e.kind === "A")?.path).toBe("migrations/045_x.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("yields an empty fingerprint for merge commits (never matches)", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      commitAll(root, "base");
      git(root, ["checkout", "-qb", "side"]);
      write(root, "side.txt", "side\n");
      commitAll(root, "side");
      git(root, ["checkout", "-q", "master"]);
      write(root, "main2.txt", "main2\n");
      commitAll(root, "main2");
      git(root, ["merge", "-q", "--no-ff", "side", "-m", "merge"]);
      expect(commitFingerprint({ repoRoot: root, revision: "HEAD" }).entries).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("findAppliedDuplicates", () => {
  it("detects the replayed twin despite the rename between (loop-lore regression)", async () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      const base = commitAll(root, "base");
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_messages_idempotency_unique.ts", MIGRATION_040);
      const a = commitAll(root, "feat(db): unique index enforces message idempotency dedup");
      git(root, [
        "mv",
        "migrations/040_messages_idempotency_unique.ts",
        "migrations/045_messages_idempotency_unique.ts",
      ]);
      write(
        root,
        "migrations/045_messages_idempotency_unique.ts",
        "// Migration: 045_messages_idempotency_unique\n"
          + "CREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);\n",
      );
      commitAll(root, "fix(db): renumber colliding migrations");
      git(root, ["checkout", "-qb", "topic", base]);
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_messages_idempotency_unique.ts", MIGRATION_040);
      const c = commitAll(
        root,
        "feat(db): unique index enforces message idempotency dedup (replayed)",
      );

      // Fixture fidelity: distinct shas, identical stable patch-ids — the
      // exact precondition git failed to dedup in loop-lore.
      expect(a).not.toBe(c);
      expect(await stablePatchId(root, a)).toBe(await stablePatchId(root, c));

      const matches = findAppliedDuplicates({
        repoRoot: root,
        candidate: "topic",
        target: "master",
      });
      expect(matches).toHaveLength(1);
      expect(matches[0]?.target).toBe(a);
      expect(matches[0]?.candidate).toBe(c);
      expect(matches[0]?.exact).toBe(true);
      const blob = git(root, ["hash-object", "migrations/040_messages_idempotency_unique.ts"])
        .trim();
      expect(matches[0]?.sharedBlobs).toEqual([blob]);

      const finding = duplicateCommitFinding(matches[0]!);
      expect(finding).toMatchObject({
        detector: "fingerprint",
        reason: "duplicate-commit",
        severity: "critical",
        rank: 95,
      });
      expect(finding.message).toContain("rename-insensitive");
      expect(finding.evidence).toContainEqual({ kind: "sha", detail: `candidate ${c}` });
      expect(finding.evidence).toContainEqual({ kind: "sha", detail: `target ${a}` });
      expect(finding.evidence).toContainEqual({ kind: "sha", detail: `shared blob ${blob}` });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts identifier-only drift as a tolerant match with token evidence", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      const base = commitAll(root, "base");
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_messages_idempotency_unique.ts", MIGRATION_040);
      commitAll(root, "A: add 040");
      git(root, ["checkout", "-qb", "topic", base]);
      mkdirSync(join(root, "migrations"));
      write(
        root,
        "migrations/045_messages_idempotency_unique.ts",
        "// Migration: 045_messages_idempotency_unique\n"
          + "CREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);\n",
      );
      commitAll(root, "C2: re-add as 045 with drifted docblock");

      const matches = findAppliedDuplicates({
        repoRoot: root,
        candidate: "topic",
        target: "master",
      });
      expect(matches).toHaveLength(1);
      expect(matches[0]?.exact).toBe(false);
      expect(matches[0]?.differingTokens).toEqual([
        "045_messages_idempotency_unique → 040_messages_idempotency_unique",
      ]);
      expect(matches[0]?.sharedBlobs[0]).toMatch(/^[0-9a-f]{40}=[0-9a-f]{40}$/);
      expect(duplicateCommitFinding(matches[0]!).rank).toBe(80);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not match distinct-content commits", () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "A: add 040");
      git(root, ["checkout", "-qb", "topic"]);
      write(
        root,
        "migrations/050_different.ts",
        "// a genuinely different migration\nDROP TABLE sessions;\n",
      );
      commitAll(root, "C3: unrelated change");
      expect(findAppliedDuplicates({ repoRoot: root, candidate: "topic", target: "master" }))
        .toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not match same blob under a different change kind", () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "A: add 040");
      git(root, ["checkout", "-qb", "topic"]);
      git(root, ["rm", "-q", "migrations/040_x.ts"]);
      commitAll(root, "C4: delete it again");
      expect(findAppliedDuplicates({ repoRoot: root, candidate: "topic", target: "master" }))
        .toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns [] for empty and merge candidates", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      commitAll(root, "base");
      git(root, ["commit", "-q", "--allow-empty", "-m", "empty"]);
      git(root, ["checkout", "-qb", "side"]);
      write(root, "side.txt", "side\n");
      commitAll(root, "side");
      git(root, ["checkout", "-q", "master"]);
      git(root, ["merge", "-q", "--no-ff", "side", "-m", "merge"]);
      expect(findAppliedDuplicates({ repoRoot: root, candidate: "master~1", target: "master~2" }))
        .toEqual([]);
      expect(findAppliedDuplicates({ repoRoot: root, candidate: "HEAD", target: "side" })).toEqual(
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("honours the maxCommits bound (rev-list order: newest first)", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      const base = commitAll(root, "base");
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "A: add 040");
      write(root, "unrelated.txt", "noise to push A one commit down\n");
      commitAll(root, "newer noise");
      git(root, ["checkout", "-qb", "topic", base]);
      mkdirSync(join(root, "migrations"));
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "C5: same content re-added");
      const bounded = findAppliedDuplicates({
        repoRoot: root,
        candidate: "topic",
        target: "master",
        maxCommits: 1,
      });
      expect(bounded).toEqual([]);
      expect(findAppliedDuplicates({ repoRoot: root, candidate: "topic", target: "master" }))
        .toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tolerant match covers M and D entries across kinds", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      commitAll(root, "base");
      mkdirSync(join(root, "migrations"), { recursive: true });
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "A: add 040");
      write(root, "migrations/040_x.ts", MIGRATION_040 + "ALTER TABLE m ADD c INT;\n");
      commitAll(root, "M: extend 040");
      git(root, ["checkout", "-qb", "topic"]);
      mkdirSync(join(root, "migrations"), { recursive: true });
      git(root, ["rm", "-q", "migrations/040_x.ts"]);
      commitAll(root, "D: remove 040");
      mkdirSync(join(root, "migrations"), { recursive: true });
      write(
        root,
        "migrations/045_x.ts",
        "// Migration: 045_x\nCREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);\n",
      );
      commitAll(root, "A: add 045 with drifted docblock");

      const matches = findAppliedDuplicates({
        repoRoot: root,
        candidate: "topic",
        target: "master",
      });
      expect(matches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tolerant match returns null when a blob is unreadable", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      commitAll(root, "base");
      mkdirSync(join(root, "migrations"), { recursive: true });
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "A: add 040");
      git(root, ["checkout", "-qb", "topic"]);
      mkdirSync(join(root, "migrations"), { recursive: true });
      write(
        root,
        "migrations/045_x.ts",
        "// Migration: 045_x\nCREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);\n",
      );
      commitAll(root, "A: add 045 with drifted docblock");

      const blobSha = git(root, ["hash-object", "migrations/045_x.ts"]).trim();
      const objPath = join(root, ".git/objects", blobSha.slice(0, 2), blobSha.slice(2));
      rmSync(objPath);

      const matches = findAppliedDuplicates({
        repoRoot: root,
        candidate: "topic",
        target: "master",
      });
      expect(matches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tolerant match returns null when kind counts differ", () => {
    const root = makeRepo();
    try {
      write(root, "base.txt", "base\n");
      commitAll(root, "base");
      mkdirSync(join(root, "migrations"), { recursive: true });
      write(root, "migrations/040_x.ts", MIGRATION_040);
      commitAll(root, "A: add 040");
      git(root, ["checkout", "-qb", "topic"]);
      mkdirSync(join(root, "migrations"), { recursive: true });
      write(root, "migrations/045_x.ts", "// Migration: 045_x\nCREATE UNIQUE INDEX uq2 ON m(k);\n");
      write(root, "migrations/046_x.ts", "// Migration: 046_x\nCREATE UNIQUE INDEX uq3 ON m(k);\n");
      commitAll(root, "A: add 045 and 046");

      const matches = findAppliedDuplicates({
        repoRoot: root,
        candidate: "topic",
        target: "master",
      });
      expect(matches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
