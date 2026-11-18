// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Backend guard for the shared create/new-branch worktree bootstrap. */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { bootstrapWorktree } from "./worktree-bootstrap";

describe("bootstrapWorktree backend guard", () => {
  test("non-git backend refuses before any filesystem or git mutation", async () => {
    const repoRoot = mkdtempSync(join(scratchRoot(), "giwt-bootstrap-guard-"));
    const treeDir = join(repoRoot, "tree");
    try {
      const config: WorktreeConfig = {
        repoRoot,
        worktreeRoot: repoRoot,
        treeDir,
        settings: { ...DEFAULT_SETTINGS, vcs: { backend: "pijul" } },
      };
      let message = "";
      try {
        await bootstrapWorktree({
          config,
          wtPath: join(treeDir, "feature"),
          branch: "feature",
          hooksReason: "test",
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("giwt worktree bootstrap");
      expect(message).toContain("[vcs] backend = \"pijul\"");
      expect(existsSync(treeDir)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
