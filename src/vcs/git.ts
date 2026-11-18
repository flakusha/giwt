// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Git backend: delegates to the existing helpers, so git stays byte-identical. */

import { getBranches, getStatus, getWorktrees, gitSync } from "../utils/git";
import type { VcsBackend } from "./types";

export const gitBackend: VcsBackend = {
  name: "git",

  async listBranches(root) {
    const branches = await getBranches(root);
    return branches.map(({ name, current }) => ({ name, current }));
  },

  async listWorkspaces(root) {
    const worktrees = await getWorktrees(root);
    return worktrees.map((wt) => ({
      path: wt.path,
      branch: wt.branch.replace("refs/heads/", ""),
    }));
  },

  async status(root, branch) {
    return await getStatus(root, branch);
  },

  async diff(root, branch) {
    const output = gitSync(root, "diff", "--name-only", branch);
    return output.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  },

  async commit({ cwd, message }) {
    gitSync(cwd, "commit", "-m", message);
    return { sha: gitSync(cwd, "rev-parse", "HEAD").trim() };
  },

  async createWorkspace({ root, path, branch, base }) {
    if (base === undefined) gitSync(root, "worktree", "add", path, branch);
    else gitSync(root, "worktree", "add", "-b", branch, path, base);
  },

  async removeWorkspace({ root, path }) {
    gitSync(root, "worktree", "remove", path);
  },

  async renameWorkspace() {
    throw new Error(
      "git worktrees have no rename — use 'git worktree remove' then 'git worktree add'",
    );
  },
};
