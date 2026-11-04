// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Single source of truth for "the repo itself ignores this path".
 *
 * A repo that retires generated artifacts from tracking (`git rm --cached` +
 * a .gitignore rule) must keep them untracked: `git add -f` re-adds ignored
 * files, so every path that decides "tracked or not" has to ask the same
 * question the same way.
 *
 * The repo's own .gitignore is the source of truth. The user's global
 * excludesFile (dot-dir hygiene, e.g. a rule that hides every dot dir) is
 * neutralized: `git add -f` always bypassed it, so it must not decide what
 * stays untracked here.
 */

import { isolatedGitEnv } from "./git";

/**
 * Repo-relative paths the repo's own ignore rules cover.
 *
 * `check-ignore --no-index` reports the rules for a path regardless of the
 * index state — without it a conflicted path (still in the index) reads as
 * tracked, not ignored. Exit 1 means "no path matched a rule" and is not an
 * error.
 *
 * @throws when git check-ignore fails for any reason other than "nothing
 * matched" — a broken ignore setup must not read as "not ignored".
 */
export function repoIgnoredPaths(root: string, paths: string[]): Set<string> {
  const ignored = new Set<string>();
  if (paths.length === 0) return ignored;
  const result = Bun.spawnSync(
    [
      "git",
      "-C",
      root,
      "-c",
      "core.excludesFile=/dev/null",
      "check-ignore",
      "--no-index",
      "-z",
      "--stdin",
    ],
    {
      stdin: Buffer.from(`${paths.join("\0")}\0`),
      stdout: "pipe",
      stderr: "pipe",
      env: isolatedGitEnv(),
    },
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(
      `check-ignore failed (exit ${result.exitCode}): ${result.stderr.toString().trim()}`,
    );
  }
  for (const path of result.stdout.toString().split("\0")) {
    if (path.length > 0) ignored.add(path);
  }
  return ignored;
}
