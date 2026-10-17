// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup status --annex`: repo-level annex inventory through the
 * read-only policy rows (`whereis`/`unused` are in ANNEX_RO_SUBCOMMANDS —
 * this module SPAWNS read-only shapes only; anything else goes through the
 * `giwt git` classifier like every other caller).
 */

export interface AnnexCounts {
  whereisFiles: number;
  unusedKeys: number;
  note: string;
}

interface SyncSpawn {
  (cmd: string[]): { exitCode: number; stdout: string; stderr: string; };
}

function countWhereis(stdout: string): number {
  // `git annex whereis` prints one `whereis: <n> determined` block per file.
  return stdout.split("\n").filter((l) => l.startsWith("whereis:")).length;
}

function countUnused(stdout: string): number {
  // `git annex unused` lists numbered lines: "  1   <key>".
  return stdout.split("\n").filter((l) => /^\s+\d+\s+\S/.test(l)).length;
}

/** Read-only annex inventory; annex absence degrades to a note, not an error. */
export function annexCounts(repoRoot: string, spawn: SyncSpawn): AnnexCounts {
  const whereis = spawn(["git", "-C", repoRoot, "annex", "whereis"]);
  if (
    whereis.exitCode !== 0 && /annex: (command )?not found|not a git-annex/i.test(whereis.stderr)
  ) {
    return {
      whereisFiles: 0,
      unusedKeys: 0,
      note: "git-annex not available here — --annex counts unavailable",
    };
  }
  const unused = spawn(["git", "-C", repoRoot, "annex", "unused"]);
  return {
    whereisFiles: countWhereis(whereis.stdout),
    unusedKeys: countUnused(unused.exitCode === 0 ? unused.stdout : ""),
    note: "",
  };
}
