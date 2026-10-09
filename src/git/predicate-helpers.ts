// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Shared helpers for the per-subcommand git predicates. */

/** Options predicate helpers receive: cwd is the worktree root. */
export interface PredicateCtx {
  pathExists: (relPath: string) => boolean;
}

export const hasForceShort = (tok: string) => /^-[a-zA-Z]*[fF]/.test(tok);

/**
 * True if any combined short-flag cluster (e.g. `-ix`, not `--long`) contains
 * `ch` as a flag of its own. In git's cluster grammar everything after a
 * value-taking flag (listed in `valueChars`) is that flag's attached value, so
 * only occurrences before such a flag count.
 */
export const shortClusterIncludes = (
  args: readonly string[],
  ch: string,
  valueChars: string,
): boolean =>
  args.some((a) => {
    if (!/^-[a-zA-Z]/.test(a)) return false;
    const firstValue = Math.min(
      ...[...valueChars].map((c) => a.indexOf(c, 1)).filter((n) => n !== -1),
      a.length,
    );
    return a.slice(1, firstValue).includes(ch);
  });

/**
 * Resolve a short flag's value the way git parses clusters: for the cluster at
 * `args[i]` containing `ch`, the attached remainder after `ch` is the value (a
 * leading `=` is stripped, so `-x=v` and `-xv` agree); with no remainder, the
 * next token is the value. Returns null when the flag is absent or valueless.
 */
export function shortClusterValue(
  args: readonly string[],
  i: number,
  ch: string,
): string | null {
  const tok = args[i];
  if (tok === undefined || !/^-[a-zA-Z]/.test(tok)) return null;
  const pos = tok.indexOf(ch, 1);
  if (pos === -1) return null;
  const rest = tok.slice(pos + 1);
  if (rest === "") return args[i + 1] ?? null;
  return rest.startsWith("=") ? rest.slice(1) : rest;
}

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
