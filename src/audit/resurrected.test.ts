// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the resurrected-file scan. Real scratch repos; every child git
 * runs with isolatedGitEnv(). Fixtures mirror the loop-lore migration
 * directory as it stood after the rename-defeated replay:
 *   - 040_messages_idempotency_unique.ts and 045_messages_idempotency_
 *     unique.ts, byte-identical apart from the embedded migration name
 *     (content twins fire, numbers 40 ≠ 45 so the number check must NOT)
 *   - two files claiming the SAME leading number with genuinely different
 *     content (number check fires by definition, twin check must not)
 *   - distinct files (silent)
 *   - byte-identical copies under two paths (shared blob evidence)
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { numberCollisionFindings, scanResurrectedFiles, trackedBlobsUnder } from "./resurrected";

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
  const root = mkdtempSync(join(scratchRoot(), "giwt-resurrected-"));
  git(root, ["init", "-q", "-b", "master", "."]);
  git(root, ["config", "user.email", "giwt-test@localhost"]);
  git(root, ["config", "user.name", "giwt test"]);
  return root;
}

function commitAll(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", message]);
}

function write(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
}

function migrationDocblock(name: string): string {
  return `// Migration: ${name}\n// Creates: uq_messages_idempotency_enforced\nCREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);\n`;
}

function reasons(findings: ReturnType<typeof scanResurrectedFiles>): string[] {
  return findings.map((f) => f.reason);
}

describe("trackedBlobsUnder", () => {
  it("lists tracked files filename-ordered with their blob shas", () => {
    const root = makeRepo();
    try {
      write(root, "migrations/050_zeta.ts", "z\n");
      write(root, "migrations/030_alpha.ts", "a\n");
      write(root, "notes.md", "not in dir\n");
      commitAll(root, "seed");
      const blobs = trackedBlobsUnder({ repoRoot: root, dir: "migrations", maxFiles: 10 });
      expect(blobs.map((b) => b.path)).toEqual([
        "migrations/030_alpha.ts",
        "migrations/050_zeta.ts",
      ]);
      expect(blobs[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("numberCollisionFindings", () => {
  it("fires for a shared leading number regardless of content", () => {
    const root = makeRepo();
    try {
      write(root, "migrations/039_users_email.ts", "ALTER TABLE users ADD email TEXT;\n");
      write(
        root,
        "migrations/039_sessions_ttl.ts",
        "-- genuinely different migration with much longer content\nALTER TABLE sessions SET ttl = 3600;\n",
      );
      commitAll(root, "collide");
      const findings = scanResurrectedFiles({ repoRoot: root, dirs: ["migrations"] });
      expect(reasons(findings)).toEqual(["number-collision"]);
      expect(findings[0]).toMatchObject({
        detector: "resurrected",
        severity: "critical",
        rank: 90,
      });
      expect(findings[0]?.paths).toEqual([
        "migrations/039_sessions_ttl.ts",
        "migrations/039_users_email.ts",
      ]);
      expect(findings[0]?.evidence).toContainEqual({ kind: "token", detail: "leading number 39" });
      expect(findings[0]?.evidence).toContainEqual({ kind: "count", detail: "2 files" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores files without a leading number", () => {
    const root = makeRepo();
    try {
      write(root, "migrations/seed.ts", "a\n");
      write(root, "migrations/rollback.ts", "b\n");
      commitAll(root, "seed");
      expect(numberCollisionFindings({
        files: trackedBlobsUnder({ repoRoot: root, dir: "migrations", maxFiles: 10 }),
        dir: "migrations",
      })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("scanResurrectedFiles — content twins", () => {
  it("flags the loop-lore 040/045 pair and names the drifted token", () => {
    const root = makeRepo();
    try {
      write(
        root,
        "migrations/040_messages_idempotency_unique.ts",
        migrationDocblock("040_messages_idempotency_unique"),
      );
      write(
        root,
        "migrations/045_messages_idempotency_unique.ts",
        migrationDocblock("045_messages_idempotency_unique"),
      );
      commitAll(root, "resurrected state");
      const findings = scanResurrectedFiles({ repoRoot: root, dirs: ["migrations"] });
      expect(reasons(findings)).toEqual(["content-twin"]);
      expect(findings[0]?.paths).toEqual([
        "migrations/040_messages_idempotency_unique.ts",
        "migrations/045_messages_idempotency_unique.ts",
      ]);
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.evidence).toContainEqual({
        kind: "token",
        detail: "040_messages_idempotency_unique → 045_messages_idempotency_unique",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags byte-identical copies under two paths with the shared blob", () => {
    const root = makeRepo();
    try {
      const content = "export function stage(): number {\n  return 3;\n}\n";
      write(root, "stages/010_stage_a.ts", content);
      write(root, "stages/020_stage_b.ts", content);
      commitAll(root, "copies");
      const findings = scanResurrectedFiles({ repoRoot: root, dirs: ["stages"] });
      expect(reasons(findings)).toEqual(["content-twin"]);
      expect(findings[0]?.severity).toBe("warning");
      const sha = findings[0]?.evidence.find((e) => e.kind === "sha");
      if (sha?.kind !== "sha") throw new Error("expected sha evidence");
      expect(sha.detail).toMatch(/^shared blob [0-9a-f]{40}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stays silent on distinct files and on empty blobs", () => {
    const root = makeRepo();
    try {
      write(root, "migrations/030_create_users.ts", migrationDocblock("030_create_users"));
      write(root, "migrations/040_add_index.ts", "CREATE INDEX idx_users_email ON users(email);\n");
      write(root, "migrations/050_backfill.ts", "UPDATE users SET email = lower(email);\n");
      write(root, "migrations/.gitkeep", "");
      write(root, "migrations/other/.gitkeep", "");
      commitAll(root, "healthy");
      expect(scanResurrectedFiles({ repoRoot: root, dirs: ["migrations"] })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("same number + genuinely different content fires number-collision only", () => {
    const root = makeRepo();
    try {
      write(
        root,
        "migrations/040_messages_idempotency_unique.ts",
        migrationDocblock("040_messages_idempotency_unique"),
      );
      write(
        root,
        "migrations/040_messages_cleanup.ts",
        "-- unrelated cleanup migration, entirely different body\nDELETE FROM messages WHERE stale = 1;\n",
      );
      commitAll(root, "collision only");
      expect(reasons(scanResurrectedFiles({ repoRoot: root, dirs: ["migrations"] })))
        .toEqual(["number-collision"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans multiple dirs and sorts findings rank-descending", () => {
    const root = makeRepo();
    try {
      const content = "export function stage(): number {\n  return 3;\n}\n";
      write(root, "migrations/039_a.ts", content);
      write(root, "migrations/039_b.ts", content);
      write(root, "stages/010_x.ts", content);
      write(root, "stages/020_y.ts", content);
      commitAll(root, "multi-dir");
      const findings = scanResurrectedFiles({ repoRoot: root, dirs: ["migrations", "stages"] });
      expect(reasons(findings)).toEqual(["number-collision", "content-twin", "content-twin"]);
      const ranks = findings.map((f) => f.rank);
      expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
