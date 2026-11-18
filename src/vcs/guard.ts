// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared refusal for giwt commands that mutate git while the configured
 * backend is not git. Mutating work must go through the native backend
 * commands; git past reads stay available (see commands/git.ts).
 */

import type { GiwtSettings } from "../utils/settings";

/** Actionable refusal text, shared with the `giwt git` passthrough. */
export function gitMutationRefusal(backend: string, where: string): string {
  return `${where}: git mutations are disabled with [vcs] backend = "${backend}" — `
    + `use the native backend commands (giwt jj / giwt pijul); `
    + `to use git commands, set [vcs] backend = "git" in giwt.toml`;
}

/** Throw when a git-mutating giwt command runs under a non-git backend. */
export function assertGitMutationAllowed({
  settings,
  where,
}: {
  settings: GiwtSettings;
  where: string;
}): void {
  const backend = settings.vcs.backend;
  if (backend === "git") return;
  throw new Error(gitMutationRefusal(backend, where));
}

/** Ticket/issue substrate is git-only: no side git repo, no silent .plan-only sync. */
export function assertTicketSubstrateAllowed({
  settings,
  where,
}: {
  settings: GiwtSettings;
  where: string;
}): void {
  const backend = settings.vcs.backend;
  if (backend === "git") return;
  throw new Error(
    `${where}: the ticket issue substrate is unavailable with [vcs] backend = "${backend}" — `
      + `git-issue has no ${backend} equivalent; no side git repo is created; `
      + `set [vcs] backend = "git" in giwt.toml to use tickets/issues`,
  );
}
