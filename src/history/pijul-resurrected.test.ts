// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pijul resurrected findings with an injected pijul spawn and temp files —
 * no pijul binary and no git spawn. The stub mimics `pijul list`, which also
 * prints directory entries; the provider must ignore them.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanResurrectedFiles } from "../audit/resurrected";
import { scratchRoot } from "../utils/scratch-tmp";
import { type PijulSpawn } from "../vcs/pijul";
import { pijulResurrectedProviders } from "./pijul-resurrected";

function write(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
}

function stub(root: string, stdout: string, exitCode = 0): {
  spawn: PijulSpawn;
  calls: string[][];
} {
  const calls: string[][] = [];
  const spawn: PijulSpawn = (cmd, cwd) => {
    calls.push(cmd);
    if (cwd !== root) throw new Error(`unexpected cwd ${cwd}`);
    return { stdout, stderr: exitCode === 0 ? "" : "repo corrupt", exitCode };
  };
  return { spawn, calls };
}

const migrationDocblock = (name: string) =>
  `// Migration: ${name}\n// Creates: uq_messages_idempotency_enforced\nCREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);\n`;

describe("pijul resurrected tracked blobs (stubbed pijul list)", () => {
  test("duplicate leading numbers fire a number-collision, with no git spawn", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-pijul-resurrected-"));
    // 050_gone.ts is tracked by the stub but absent on disk: pijul list can
    // outlive a working-tree deletion, which the provider must skip.
    const list =
      "migrations\nmigrations/040_a.ts\nmigrations/040_b.ts\nmigrations/050_gone.ts\nnotes.md\n";
    try {
      write(root, "migrations/040_a.ts", "first migration\n");
      write(root, "migrations/040_b.ts", "totally different migration\n");
      write(root, "notes.md", "outside the scanned dir\n");
      const { spawn, calls } = stub(root, list);
      const findings = scanResurrectedFiles({
        repoRoot: root,
        dirs: ["migrations"],
        ...pijulResurrectedProviders({ root, spawn }),
      });
      expect(findings.map((f) => f.reason)).toEqual(["number-collision"]);
      expect(findings[0]?.paths).toEqual([
        "migrations/040_a.ts",
        "migrations/040_b.ts",
      ]);
      expect(calls).toEqual([["pijul", "list", "--repository", root]]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("drifted and byte-identical tracked files fire content twins", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-pijul-resurrected-"));
    const list = [
      "migrations",
      "migrations/040_messages_idempotency_unique.ts",
      "migrations/045_messages_idempotency_unique.ts",
      "stages",
      "stages/010_stage_a.ts",
      "stages/020_stage_b.ts",
      "",
    ].join("\n");
    try {
      const a = "040_messages_idempotency_unique";
      const b = "045_messages_idempotency_unique";
      write(root, `migrations/${a}.ts`, migrationDocblock(a));
      write(root, `migrations/${b}.ts`, migrationDocblock(b));
      const copy = "export function stage(): number {\n  return 3;\n}\n";
      write(root, "stages/010_stage_a.ts", copy);
      write(root, "stages/020_stage_b.ts", copy);
      const { spawn, calls } = stub(root, list);
      const findings = scanResurrectedFiles({
        repoRoot: root,
        dirs: ["migrations", "stages"],
        ...pijulResurrectedProviders({ root, spawn }),
      });
      expect(findings.map((f) => f.reason)).toEqual(["content-twin", "content-twin"]);
      expect(findings[0]?.evidence).toContainEqual({
        kind: "sha",
        detail: expect.stringMatching(/^shared blob [0-9a-f]{64}$/),
      });
      expect(findings[1]?.evidence).toContainEqual({
        kind: "token",
        detail: `${a} → ${b}`,
      });
      expect(calls).toEqual([
        ["pijul", "list", "--repository", root],
        ["pijul", "list", "--repository", root],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed on a bad pijul list", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-pijul-resurrected-"));
    try {
      const { spawn } = stub(root, "", 3);
      expect(() =>
        scanResurrectedFiles({
          repoRoot: root,
          dirs: ["migrations"],
          ...pijulResurrectedProviders({ root, spawn }),
        })
      ).toThrow(/repo corrupt/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blob reads miss closed for unknown shas and vanished files", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-pijul-resurrected-"));
    try {
      write(root, "migrations/040_a.ts", "content\n");
      const { spawn } = stub(root, "migrations/040_a.ts\n");
      const providers = pijulResurrectedProviders({ root, spawn });
      const blobs = providers.trackedBlobs({ repoRoot: root, dir: "migrations", maxFiles: 10 });
      const sha = blobs[0]?.sha;
      if (sha === undefined) throw new Error("expected a tracked blob");

      const unknown = "f".repeat(64);
      const unknownCache = new Map<string, string | null>();
      expect(
        providers.blobText({ repoRoot: root, sha: unknown, maxBytes: 100, cache: unknownCache }),
      )
        .toBeNull();
      expect(unknownCache.get(unknown)).toBeNull();

      rmSync(join(root, "migrations/040_a.ts"));
      const vanishedCache = new Map<string, string | null>();
      expect(providers.blobText({ repoRoot: root, sha, maxBytes: 100, cache: vanishedCache }))
        .toBeNull();
      expect(vanishedCache.get(sha)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
