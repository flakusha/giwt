// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Author-identity guard for commit/merge paths.
 *
 * GPG signing validates the COMMITTER, not the AUTHOR — a tampered repo
 * user.email silently rewrites authorship while the signature stays valid.
 * Every commit/merge-creating path must assert that the repo-config author
 * matches the maintainer identity from `.credentials.env` before spawning git.
 *
 * Escape hatch: `--allow-author-override` flag or `GIWT_ALLOW_AUTHOR_OVERRIDE=1`
 * env. Both print a loud warning so an override requires maintainer notice.
 *
 * COVERAGE RULE — every commit-producing path must call the guard (directly,
 * or via assertGitAuthorIdentity) before spawning git. Guarded paths:
 * commit, commit-wt, merge, finalize staging (all strategies — guarded once
 * in executeStagingMerge, post worktree-add), scoped-worktree scope commit,
 * scoped-worktree post-merge reconciliation, rebase, and the `giwt git`
 * passthrough for commit-class subcommands. A new commit path without a
 * guard call is a security regression.
 */

import { gitSyncQuiet } from "./git";
import { log, raw } from "./output";

export const ALLOW_AUTHOR_OVERRIDE_FLAG = "--allow-author-override";
export const ALLOW_AUTHOR_OVERRIDE_ENV = "GIWT_ALLOW_AUTHOR_OVERRIDE";

/** Whether the caller explicitly opted out of the author guard. */
export function authorOverrideAllowed(args: string[]): boolean {
  if (args.includes(ALLOW_AUTHOR_OVERRIDE_FLAG)) return true;
  const env = process.env[ALLOW_AUTHOR_OVERRIDE_ENV];
  return env === "1" || env === "true";
}

export interface AuthorGuardParams {
  /** The author email read from the repo's local git config. */
  authorEmail: string;
  /** The expected maintainer email (from .credentials.env / config). */
  expectedEmail: string;
  /** Raw CLI args, checked for `--allow-author-override`. */
  args: string[];
  /** Human-readable action for the error message (e.g. "commit", "merge"). */
  source: string;
}

/**
 * Refuse to create a commit/merge when the repo-config author email does not
 * match the maintainer email from `.credentials.env`.
 *
 * Email is the identity — compared case-insensitively after trim. Names may
 * legitimately differ (e.g. "Konstantin Fedotov" vs "Konstantin Fedotov (Agent)")
 * and are not compared.
 *
 * On mismatch without an override: logs an actionable error naming the expected
 * email and how to fix the repo identity, then exits 1. With an override: logs a
 * loud warning and returns.
 */
export function assertAuthorMatchesCommitter(params: AuthorGuardParams): void {
  const { authorEmail, expectedEmail, args, source } = params;
  if (!expectedEmail) return;

  const expected = expectedEmail.trim().toLowerCase();
  const actual = authorEmail.trim().toLowerCase();
  if (actual === expected) return;

  if (authorOverrideAllowed(args)) {
    log(
      "warn",
      `AUTHOR OVERRIDE: repo author '${authorEmail}' does not match maintainer '${expectedEmail}'`,
    );
    raw(`  This ${source} will be authored by '${authorEmail}' — an explicit override was given.`);
    return;
  }

  log(
    "error",
    `refusing to ${source}: repo author '${authorEmail}' does not match maintainer '${expectedEmail}'`,
  );
  raw(`  Fix: update the repo's local user.email to the maintainer address`);
  raw(
    `  Or:   pass ${ALLOW_AUTHOR_OVERRIDE_FLAG} (or set ${ALLOW_AUTHOR_OVERRIDE_ENV}=1) to override explicitly`,
  );
  process.exit(1);
}

/**
 * Convenience wrapper for the common guard shape: read the repo-config
 * author from `cwd` (the checkout where the commit will run), then refuse
 * on mismatch. Sites that already read `user.email` for display call
 * assertAuthorMatchesCommitter directly instead.
 */
export function assertGitAuthorIdentity(check: {
  /** Directory whose repo config provides the author identity. */
  cwd: string;
  /** Expected maintainer email (config.agentGpgEmail); empty short-circuits. */
  expectedEmail: string;
  /** Raw CLI args, checked for `--allow-author-override`. */
  args: string[];
  /** Human-readable action for the error message (e.g. "commit"). */
  source: string;
}): void {
  const authorEmail = gitSyncQuiet(check.cwd, "config", "user.email");
  if (!authorEmail) return;
  assertAuthorMatchesCommitter({
    authorEmail,
    expectedEmail: check.expectedEmail,
    args: check.args,
    source: check.source,
  });
}
