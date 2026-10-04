// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt task` flag vocabulary. Single source of truth for both parsing
 * (task/args.ts) and the `--vocab` machine-readable dump.
 */

/** Flag tokens `task` accepts. Static table per repo convention. */
export const FLAG_TOKENS: Record<string, true> = {
  "-m": true,
  "-d": true,
  "--message": true,
  "--directive": true,
  "-F": true,
  "--file": true,
  "-j": true,
  "--jobs": true,
  "-a": true,
  "--agents": true,
  "--good": true,
  "--fast": true,
  "-g": true,
  "--gates": true,
  "--strict": true,
  "--shallow": true,
  "--deep": true,
  "-s": true,
  "--skills": true,
  "-w": true,
  "--worktree": true,
  "--base": true,
  "--tickets": true,
  "--follow": true,
  "--careful": true,
  "--docs": true,
  "--roster": true,
  "--vocab": true,
};

/** Closed value vocabularies for value-taking flags (single source of
 * truth for both parsing and the --vocab machine-readable dump). */
export const SKILLS_MODES = ["min", "max", "reasonable"] as const;
export const GATES_KEYWORDS = ["all", "none"] as const;

/** Allowed values per value-taking flag; flags absent here accept
 * free-form text. */
export const VALUE_VOCAB: Record<string, readonly string[]> = {
  "-s": SKILLS_MODES,
  "--skills": SKILLS_MODES,
  "-g": GATES_KEYWORDS,
  "--gates": GATES_KEYWORDS,
};

/** Flags that take no value (and their long-form aliases). */
export const NO_VALUE_FLAGS = [
  "--strict",
  "--shallow",
  "--deep",
  "-w",
  "--worktree",
] as const;

/** Machine-readable flag vocabulary behind `task --vocab`: every accepted
 * flag token, the closed value vocabularies, and the no-value flags. */
export function taskFlagVocab(): {
  flags: string[];
  values: Record<string, string[]>;
  noValue: string[];
} {
  const values: Record<string, string[]> = {};
  for (const [token, vocab] of Object.entries(VALUE_VOCAB)) {
    values[token] = [...vocab];
  }
  return {
    flags: Object.keys(FLAG_TOKENS).sort(),
    values,
    noValue: [...NO_VALUE_FLAGS],
  };
}
