// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the `gripe` command.
 *
 * Coverage:
 *   - positional words join into one message, prefixed with 😤
 *   - `--at` / `--at=` tags the target branch
 *   - empty message exits 1 with usage
 *   - `--at` without a value exits 1
 *   - exactly one record per run (no generic auto-append double-log;
 *     the dispatcher owns that, this asserts the command writes one)
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gripe } from "./commands/gripe";
import type { WorktreeConfig } from "./utils/config";
import { readLedger } from "./utils/ledger";
import { DEFAULT_SETTINGS } from "./utils/settings";

function makeConfig(): { config: WorktreeConfig; dir: string; } {
  const dir = mkdtempSync(join(tmpdir(), "giwt-gripe-"));
  return {
    config: { repoRoot: dir, worktreeRoot: dir, treeDir: dir, settings: DEFAULT_SETTINGS },
    dir,
  };
}

function mockExit(): { calls: number[]; restore: () => void; } {
  const origExit = process.exit;
  const calls: number[] = [];
  process.exit = ((code: number) => {
    calls.push(code);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    calls,
    restore: () => {
      process.exit = origExit;
    },
  };
}

describe("gripe", () => {
  it("records words as one message aimed at --at", async () => {
    const { config, dir } = makeConfig();
    try {
      await gripe(["--at", "my-branch", "you", "left", "dev", "mid-merge"], config);
      const records = readLedger(dir, 10);
      expect(records.length).toBe(1);
      expect(records[0]!.cmd).toBe("gripe");
      expect(records[0]!.branch).toBe("my-branch");
      expect(records[0]!.msg).toBe("gripe my-branch :: 😤 you left dev mid-merge");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports --at= and works without a target", async () => {
    const { config, dir } = makeConfig();
    try {
      await gripe(["--at=other-branch", "again"], config);
      const records = readLedger(dir, 10);
      expect(records[0]!.branch).toBe("other-branch");
      expect(records[0]!.msg).toBe("gripe other-branch :: 😤 again");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 when the message is empty", async () => {
    const { config, dir } = makeConfig();
    const exit = mockExit();
    try {
      await expect(gripe(["--at", "b"], config)).rejects.toThrow("__exit:1");
      expect(exit.calls).toEqual([1]);
      expect(readLedger(dir, 10)).toEqual([]);
    } finally {
      exit.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 when --at has no value", async () => {
    const { config, dir } = makeConfig();
    const exit = mockExit();
    try {
      await expect(gripe(["--at"], config)).rejects.toThrow("__exit:1");
    } finally {
      exit.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
