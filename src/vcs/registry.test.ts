// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// Resource contract: the git fixture is a fresh mkdtemp repo under
// scratchRoot() and is removed in finally; no shared paths or cwd changes.

import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeGitRepo } from "../testkit/capture";
import { gitSync } from "../utils/git";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { resolveVcsBackend } from "./registry";

describe("VCS backend registry", () => {
  test("git backend delegates to the existing helpers", async () => {
    const root = makeGitRepo("vcs-backend", { branches: ["feature"] });
    try {
      const backend = resolveVcsBackend(DEFAULT_SETTINGS);
      expect(backend.name).toBe("git");

      const branches = await backend.listBranches(root);
      expect(branches.map((b) => b.name)).toEqual(["feature", "main"]);
      expect(branches.find((b) => b.name === "main")?.current).toBe(true);

      const workspaces = await backend.listWorkspaces(root);
      expect(workspaces.map((w) => w.branch)).toEqual(["main"]);
      expect(workspaces.some((w) => w.branch.startsWith("refs/heads/"))).toBe(false);

      expect(await backend.status(root, "main")).toEqual({
        branch: "main",
        ahead: 0,
        behind: 0,
        clean: true,
      });

      writeFileSync(join(root, "staged.txt"), "x\n");
      gitSync(root, "add", "staged.txt");
      expect(await backend.diff(root, "HEAD")).toEqual(["staged.txt"]);

      const committed = await backend.commit({ cwd: root, message: "vcs seam smoke" });
      expect(committed.sha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("registered-but-unimplemented backends refuse instead of falling back", () => {
    for (const backend of ["jj", "pijul"] as const) {
      expect(() =>
        resolveVcsBackend({
          ...DEFAULT_SETTINGS,
          vcs: { backend },
        })
      ).toThrow(new RegExp(`vcs backend '${backend}' is not implemented yet`));
    }
  });
});
