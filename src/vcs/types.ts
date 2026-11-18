// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * VCS primitive seam. Backends expose raw VCS operations only; giwt policy
 * (identity, signing, ledger, hooks) stays in the command layer.
 */

/** Registered `[vcs] backend` values. */
export const VCS_BACKENDS = ["git", "jj", "pijul"] as const;
export type VcsBackendName = (typeof VCS_BACKENDS)[number];

/** Registered but not implemented yet. Settings load refuses these so no
 * legacy git call site can run behind the user's back. */
export const VCS_UNIMPLEMENTED_BACKENDS: readonly VcsBackendName[] = ["jj", "pijul"];

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
  /** Changed paths in the working tree vs. `ref` (not branch vs. base). */
  diff(root: string, branch: string): Promise<string[]>;
  commit(options: VcsCommitOptions): Promise<VcsCommitResult>;
}

const BACKEND_TICKETS: Record<string, string> = {
  jj: "FEAT-feat-jj-jujutsu-vcs-support.md",
  pijul: "FEAT-feat-pijul-vcs-support.md",
};

/** Shared refusal for a registered but unimplemented backend. */
export function vcsBackendRefusal(name: string): string {
  const ticket = BACKEND_TICKETS[name] ?? "FEAT-feat-vcs-backend-seam-and-backend-setting.md";
  return `vcs backend '${name}' is not implemented yet - see .plan/tickets/${ticket} `
    + `(set [vcs] backend = "git" in giwt.toml)`;
}
