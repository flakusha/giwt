// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the non-worktree-target error path of `giwt merge`.
 *
 * Regression target (ticket FIX-errors-carry-no-remedy): "no worktree found
 * for branch 'dev'" stated the symptom but not the contract — merge targets
 * worktree checkouts only — and offered no create+finalize path, so the
 * caller had to read the source to learn the workflow. The fix names the
 * contract and the exact commands.
 *
 * Strategy: an empty treeDir means no worktree exists for any branch, so
 * the real `merge()` entry point takes the error path before any git or
 * GPG interaction.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { merge } from "./merge";

let root: string;
let config: WorktreeConfig;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "giwt-merge-"));
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"), // empty: no worktrees registered
    settings: DEFAULT_SETTINGS,
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("merge non-worktree target error (FIX-errors-carry-no-remedy)", () => {
  test("names the worktree-only contract and the create+finalize path", async () => {
    const outSpy = spyOn(process.stdout, "write");
    const errSpy = spyOn(process.stderr, "write");
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        throw new Error(`__exit__:${code}`);
      }) as typeof process.exit,
    );
    outSpy.mockImplementation(() => true);
    errSpy.mockImplementation(() => true);
    try {
      let aborted = false;
      let message = "";
      try {
        await merge(["dev", "skip-heavy-db"], config);
      } catch (err) {
        message = (err as Error).message;
        aborted = true;
      }
      expect(message).toBe("__exit__:1");
      expect(aborted).toBe(true);
      const out = [
        ...outSpy.mock.calls.map((args) => String(args[0])),
        ...errSpy.mock.calls.map((args) => String(args[0])),
      ].join("");
      expect(out).toContain("no worktree found for branch 'dev'");
      // The worktree-only contract is explained.
      expect(out).toContain("worktree checkouts only");
      // The create+finalize path is suggested with exact commands.
      expect(out).toContain("giwt new-branch dev");
      expect(out).toContain("giwt finalize");
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
