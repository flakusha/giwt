// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * The `git config` gate — reads pass, writes (every shape) are refused.
 * Split out of predicates.ts for size; re-exported via its PREDICATES map.
 */

/** `git config` — reads pass, writes (all shapes) are refused. */
export function configPredicate(args: readonly string[]): string | null {
  const WRITE_SUBVERBS = new Set([
    "set",
    "unset",
    "unset-all",
    "add",
    "replace-all",
    "edit",
    "rename-section",
    "remove-section",
  ]);
  const WRITE_FLAGS = new Set([
    "--add",
    "--replace-all",
    "--unset",
    "--unset-all",
    "--remove-section",
    "--rename-section",
    "-e",
    "--edit",
  ]);
  const positional = args.filter((a) => !a.startsWith("-"));
  if (positional.length > 0 && WRITE_SUBVERBS.has(positional[0]!)) {
    return `git config ${positional[0]} is a config write — agents must never modify git config`;
  }
  // git >= 2.46 read subverbs: `config get <name> [<value-pattern>]`,
  // `config list [options]` — reads, never writes.
  if (positional[0] === "get" || positional[0] === "list") return null;
  if (args.some((a) => WRITE_FLAGS.has(a))) {
    return "git config write flag refused — agents must never modify git config";
  }
  const READ_MARKERS = new Set([
    "--get",
    "--get-all",
    "--get-regexp",
    "--get-urlmatch",
    "--list",
    "-l",
    "--name-only",
  ]);
  // `git config --get <name> <value-pattern>` is a read with two positionals.
  if (args.some((a) => READ_MARKERS.has(a))) return null;
  if (positional.length >= 2) {
    return "git config <key> <value> is a config write — agents must never modify git config";
  }
  return null;
}
