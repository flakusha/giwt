// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// Resource contract: one fresh mkdtemp git repo per test, removed in afterEach;
// output capture is restored in finally. No cwd or env mutation.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { captureOutput, makeGitRepo } from "../testkit/capture";
import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { execute } from "./branches";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

function config(root: string, backend: "git" | "jj" = "git"): WorktreeConfig {
  return {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: root,
    settings: { ...DEFAULT_SETTINGS, vcs: { backend } },
  };
}

describe("giwt branches via VCS registry", () => {
  test("git output stays byte-identical after the seam swap", async () => {
    const root = makeGitRepo("branches-seam", { branches: ["feature"] });
    const wt = mkdtempSync(join(scratchRoot(), "giwt-branches-wt-"));
    temps.push(root, wt);
    gitSync(root, "worktree", "add", wt, "feature");
    const capture = captureOutput();
    try {
      await execute([], config(root));
      expect(capture.out()).toBe(
        "\n-- Branches\n"
          + "   feature [wt] (up to date)\n"
          + "  *main [wt] (protected) (up to date)\n\n",
      );
    } finally {
      capture.restore();
    }
  });

  test("resolves the backend through the registry, not a direct git helper", async () => {
    const root = makeGitRepo("branches-seam-registry");
    temps.push(root);
    // A plain git fixture is not a colocated jj repo: the native backend must
    // refuse on its own guards, never by falling back to git.
    await expect(execute([], config(root, "jj")))
      .rejects.toThrow(/jj (--version|git colocation)/);
  });
});
