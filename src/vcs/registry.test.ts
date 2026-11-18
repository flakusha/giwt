// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// Resource contract: the git fixture is a fresh mkdtemp repo under
// scratchRoot() and is removed in finally; no shared paths or cwd changes.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeGitRepo } from "../testkit/capture";
import { gitSync } from "../utils/git";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { resolveVcsBackend } from "./registry";
import { vcsBackendRefusal } from "./types";

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

  test("git workspace primitives add and remove a worktree", async () => {
    const root = makeGitRepo("vcs-workspace", { branches: ["feature"] });
    const wt = mkdtempSync(join(root, "vcs-wt-"));
    try {
      const backend = resolveVcsBackend(DEFAULT_SETTINGS);
      await backend.createWorkspace({ root, path: wt, branch: "feature" });
      expect(existsSync(join(wt, ".git"))).toBe(true);
      await backend.removeWorkspace({ root, path: wt });
      expect(existsSync(join(wt, ".git"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("jj resolves to the native backend", () => {
    const backend = resolveVcsBackend({ ...DEFAULT_SETTINGS, vcs: { backend: "jj" } });
    expect(backend.name).toBe("jj");
  });

  test("pijul resolves to the native backend", () => {
    const backend = resolveVcsBackend({ ...DEFAULT_SETTINGS, vcs: { backend: "pijul" } });
    expect(backend.name).toBe("pijul");
  });

  test("unknown backend values refuse instead of falling back to git", () => {
    expect(() =>
      resolveVcsBackend({
        ...DEFAULT_SETTINGS,
        vcs: { backend: "hg" as typeof DEFAULT_SETTINGS.vcs.backend },
      })
    ).toThrow(vcsBackendRefusal("hg"));
  });
});
