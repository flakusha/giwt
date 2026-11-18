// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Backend guard for the stale-worktree cleanup command. */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute } from "./cleanup";

describe("cleanup backend guard", () => {
  test("non-git backend refuses before probing or removing worktrees", async () => {
    const repoRoot = mkdtempSync(join(scratchRoot(), "giwt-cleanup-guard-"));
    const treeDir = join(repoRoot, "tree");
    mkdirSync(treeDir);
    const keep = join(treeDir, "keep.txt");
    writeFileSync(keep, "keep");
    try {
      const config: WorktreeConfig = {
        repoRoot,
        worktreeRoot: repoRoot,
        treeDir,
        settings: { ...DEFAULT_SETTINGS, vcs: { backend: "jj" } },
      };
      let message = "";
      try {
        await execute([], config);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("giwt cleanup");
      expect(message).toContain("[vcs] backend = \"jj\"");
      expect(existsSync(keep)).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
