// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * VCS primitive seam. Backends expose raw VCS operations only; giwt policy
 * (identity, signing, ledger, hooks) stays in the command layer.
 */

/** Registered `[vcs] backend` values. */
export const VCS_BACKENDS = ["git", "jj", "pijul"] as const;
export type VcsBackendName = (typeof VCS_BACKENDS)[number];

/** A branch (git) or bookmark (jj). */
export interface VcsBranch {
  name: string;
  current: boolean;
}

/** A checkout: a git worktree or a jj workspace. */
export interface VcsWorkspace {
  path: string;
  /** Bare branch name; empty when the backend has no branch concept. */
  branch: string;
}

/** Sync state of one branch against the backend's base branch. */
export interface VcsStatus {
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
}

export interface VcsCommitOptions {
  cwd: string;
  message: string;
}

export interface VcsCommitResult {
  sha: string;
}

/** The surface every VCS backend implements. No `head`: jj cannot fill it. */
export interface VcsBackend {
  readonly name: VcsBackendName;
  listBranches(root: string): Promise<VcsBranch[]>;
  listWorkspaces(root: string): Promise<VcsWorkspace[]>;
  status(root: string, branch: string): Promise<VcsStatus>;
  diff(root: string, branch: string): Promise<string[]>;
  commit(options: VcsCommitOptions): Promise<VcsCommitResult>;
}

/** Shared refusal for a registered but unimplemented backend. */
export function vcsBackendRefusal(name: string): string {
  return `vcs backend '${name}' is not implemented yet - see .tmp/research/${name}/ `
    + `(set [vcs] backend = "git" in giwt.toml)`;
}
