// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Shared helpers for the per-subcommand git predicates. */

/** Options predicate helpers receive: cwd is the worktree root. */
export interface PredicateCtx {
  pathExists: (relPath: string) => boolean;
}

export const hasForceShort = (tok: string) => /^-[a-zA-Z]*[fF]/.test(tok);

/** Interactive patch/select modes open a TTY loop — refused everywhere. */
export function interactiveFlag(args: readonly string[]): string | null {
  if (args.includes("-p") || args.includes("--patch")) {
    return "patch mode opens an interactive TTY loop";
  }
  if (args.includes("--interactive") || args.includes("-i")) {
    return "interactive mode opens a TTY loop";
  }
  return null;
}
