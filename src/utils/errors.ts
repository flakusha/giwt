// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * User-facing error reporters that carry the actionable remedy the
 * ticket FIX-errors-carry-no-remedy requires: every error string names
 * at least one next step (a candidate ref, a config override, or an
 * explicit alternative invocation). Output-only; callers exit.
 */

import { type WorktreeConfig } from "./config";
import { gitSync } from "./git";
import { log, raw } from "./output";

/** List local branch short names. Used by the missing-ref reporters below. */
function listLocalBranches(config: WorktreeConfig): string[] {
  // `git branch --format` emits `(HEAD detached at <sha>)` when the worktree
  // is in detached state — that is not a branch and must not appear in the
  // candidate list shown to users running from a one-off checkout (e.g. CI).
  return gitSync(config.repoRoot, "branch", "--format=%(refname:short)")
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !b.startsWith("(HEAD"));
}

/**
 * Report a missing base ref for `giwt new-branch`. The remedy points at
 * existing branches to base on, the `[branches] root` giwt.toml override,
 * and the explicit-base escape hatch.
 */
export function reportMissingBase(
  base: string,
  branch: string,
  config: WorktreeConfig,
): void {
  log("error", `base '${base}' does not exist (checked as branch, tag, and commit)`);
  const candidates = listLocalBranches(config);
  if (candidates.length > 0) {
    raw(`  Existing branches you can base on: ${candidates.join(", ")}`);
  } else {
    raw("  No local branches exist yet — pass a commit or tag as the base instead.");
  }
  raw(
    `  Change the default base in giwt.toml: [branches] root = "<branch>" (currently '${config.settings.branches.root}').`,
  );
  raw(`  Or pass one explicitly: giwt new-branch ${branch} <base>`);
}

/**
 * Report a missing branch-to-checkout for `giwt create`. Different shape
 * from reportMissingBase: `create` only checks out an existing branch, so
 * the remedy is `giwt new-branch` — not a base override.
 */
export function reportMissingBranch(
  branch: string,
  config: WorktreeConfig,
): void {
  log("error", `branch '${branch}' does not exist (checked as branch, tag, and commit)`);
  const candidates = listLocalBranches(config);
  if (candidates.length > 0) {
    raw(`  Existing branches you can check out: ${candidates.join(", ")}`);
  } else {
    raw("  No local branches exist yet — create one first: giwt new-branch <name> [base]");
  }
  raw(`  Or create it: giwt new-branch ${branch} [base]`);
}
