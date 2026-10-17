// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Annex-aware dump gate: the L0 tar payload stores worktree annex SYMLINKS,
 * not content — a repo with dropped-but-present annexed files would dump
 * green while silently losing every dropped file's content on restore.
 * Detection is filesystem-only (`.git/annex` presence), so non-annex repos
 * pay zero spawn cost; the availability probe is the read-only
 * `git annex find --not --in here` (default-allow RO row in the passthrough
 * policy), bounded to ONE spawn per dump.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "../utils/output";

export interface AnnexAdvisory {
  /** Worktree annexed files whose content is NOT available locally. */
  dropped: number;
  /** Up to 5 affected paths, for the human-facing warning. */
  sample: string[];
}

interface GateSpawn {
  (cmd: string[]): { exitCode: number; stdout: string; stderr: string; };
}

/** Git dir of `repoRoot` without spawning: `.git` dir, or the gitdir pointer
 *  inside a worktree `.git` file. */
function gitDirOf(repoRoot: string): string | null {
  const dotGit = join(repoRoot, ".git");
  if (statSync(dotGit, { throwIfNoEntry: false })?.isDirectory()) return dotGit;
  try {
    const m = /gitdir:\s*(\S+)/.exec(readFileSync(dotGit, "utf8"));
    if (m === null || m[1] === undefined) return null;
    return resolve(repoRoot, m[1]);
  } catch {
    return null;
  }
}

/**
 * Advisory for a dump of `repoRoot`, or null when the dump needs no
 * warning: non-annex repo, annex probe unavailable, or every annexed
 * worktree file has its content present locally (dropped === 0).
 */
export function annexAdvisory(
  { repoRoot, spawn }: { repoRoot: string; spawn: GateSpawn; },
): AnnexAdvisory | null {
  const gitDir = gitDirOf(repoRoot);
  if (gitDir === null || !existsSync(join(gitDir, "annex"))) return null;
  const find = spawn(["git", "-C", repoRoot, "annex", "find", "--not", "--in", "here"]);
  if (find.exitCode !== 0) return null;
  const files = find.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (files.length === 0) return null;
  return { dropped: files.length, sample: files.slice(0, 5) };
}

/** Emit the loud annex advisory: count, sample paths, remediation — never a
 *  bare "annex detected". */
export function warnAnnexAdvisory(advisory: AnnexAdvisory): void {
  log(
    "warn",
    `backup: git-annex repo with ${advisory.dropped} dropped-but-present annexed file(s)`
      + ` — this archive stores 0-byte symlinks for them, NOT content; `
      + `remediation: 'git annex get <files>', or a backup target covering .git/annex`,
  );
  for (const file of advisory.sample) log("warn", `backup: annex content missing: ${file}`);
  if (advisory.dropped > advisory.sample.length) {
    log("warn", `backup: … and ${advisory.dropped - advisory.sample.length} more`);
  }
}
