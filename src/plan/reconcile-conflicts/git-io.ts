// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Git plumbing for plan-conflict reconciliation: the spawn wrapper, the
 * ancestry test, unmerged-path listing, and root/path resolution helpers.
 */

import { renameSync, writeFileSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { isolatedGitEnv } from "../../utils/git";

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runGit(root: string, ...args: string[]): GitResult {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedGitEnv(), GIT_EDITOR: "true" },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/**
 * True when `ancestor` is already contained in `descendant`.
 *
 * `git merge-base --is-ancestor` exits 0 for "is an ancestor", 1 for "is not",
 * and 128 for a bad/unknown ref. An unknown ref must not read as a no-op, so
 * anything other than exit 0 is false and the caller's normal flow surfaces
 * the error.
 */
export function isAncestorOf(root: string, ancestor: string, descendant: string): boolean {
  return runGit(root, "merge-base", "--is-ancestor", ancestor, descendant).exitCode === 0;
}

export function fromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

export function repoPath(root: string, path: string): string {
  return normalize(relative(root, fromRoot(root, path))).replaceAll("\\", "/");
}

export function unmergedPaths(root: string): string[] {
  return runGit(root, "diff", "--name-only", "--diff-filter=U")
    .stdout.split("\n")
    .map((path) => path.trim())
    .filter(Boolean);
}

/**
 * Unmerged paths mapped to the index stages git recorded for each.
 *
 * Stage 2 is "ours" — during a rebase that is the upstream side. A path
 * without stage 2 was deleted upstream (modify/delete conflict); a path with
 * stage 2 still exists upstream.
 */
export function unmergedStages(root: string): Map<string, number[]> {
  const stages = new Map<string, number[]>();
  // -z: NUL-separated records with raw paths (no pathname quoting), so the
  // path can be handed to git as-is.
  for (const record of runGit(root, "ls-files", "-u", "-z").stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const stage = Number(record.slice(0, tab).split(/\s+/)[2]);
    const path = record.slice(tab + 1);
    if (!Number.isInteger(stage)) continue;
    const recorded = stages.get(path);
    if (recorded) recorded.push(stage);
    else stages.set(path, [stage]);
  }
  return stages;
}

export function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}
