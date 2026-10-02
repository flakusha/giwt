// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../../utils/config";
import { isolatedGitEnv } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { FINALIZE_STASH_PREFIX } from "../abort";

export function gpgMergeFlags(config: WorktreeConfig): string[] {
  if (!config.agentGpgKeyId) return [];
  const gpgCheck = Bun.spawnSync(
    ["gpg", "--list-secret-keys", config.agentGpgKeyId],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (gpgCheck.exitCode !== 0) return [];
  return [
    "-c",
    "commit.gpgsign=true",
    "-c",
    `user.signingkey=${config.agentGpgKeyId}`,
  ];
}

export function branchToSquashMessage(branch: string): string {
  let type = "chore";
  let subject = branch;

  const match = branch.match(/^(feature|fix|refactor|perf|docs|test|chore)\//);
  if (match) {
    const matched = match[1]!;
    type = matched === "feature" ? "feat" : matched;
    subject = branch.slice(match[0].length);
  }

  subject = subject.replace(/-/g, " ");
  subject = subject.charAt(0).toUpperCase() + subject.slice(1);

  return `${type}: ${subject}`;
}

/**
 * Stash dirty working-tree state on `repoRoot` (the dev checkout) before
 * an in-place merge. Returns a label identifying the stash entry, or `null`
 * if the tree was already clean. The caller MUST call `restoreDirtyDev()`
 * with the same label after the merge completes — even on failure — to
 * avoid losing uncommitted work in the dev checkout.
 *
 * Why: `git merge --ff-only` refuses to proceed when the working tree has
 * uncommitted changes that overlap with the merge. This is the most common
 * cause of FF failure in finalize; auto-stashing makes the flow robust
 * against races where another agent or hook mutates dev mid-finalize.
 */
export function stashDevForMerge(repoRoot: string): string | null {
  const dirty = Bun.spawnSync(["git", "-C", repoRoot, "diff", "--quiet", "--ignore-submodules"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const staged = Bun.spawnSync([
    "git",
    "-C",
    repoRoot,
    "diff",
    "--cached",
    "--quiet",
    "--ignore-submodules",
  ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
  const untracked = Bun.spawnSync([
    "git",
    "-C",
    repoRoot,
    "ls-files",
    "--others",
    "--exclude-standard",
  ], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
  const hasUntracked = untracked.stdout.toString().trim().length > 0;
  if (dirty.exitCode === 0 && staged.exitCode === 0 && !hasUntracked) {
    return null;
  }
  // Generate a distinguishable stash label so we can find it again even if
  // the user has unrelated stashes on the stack.
  const stashLabel = `${FINALIZE_STASH_PREFIX}${Date.now().toString(36)}`;
  const flags = hasUntracked ? ["--include-untracked"] : [];
  const stash = Bun.spawnSync(
    ["git", "-C", repoRoot, "stash", "push", ...flags, "-m", stashLabel],
    { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" },
  );
  if (stash.exitCode !== 0) {
    log("error", `failed to stash dirty dev checkout: ${stash.stderr.toString().trim()}`);
    process.exit(1);
  }
  log("info", `Stashed dirty dev checkout as '${stashLabel}'`);
  return stashLabel;
}

/**
 * Restore the dev checkout from a stash entry created by `stashDevForMerge`,
 * with transactional semantics: if `git stash pop` conflicts with the
 * post-merge tree (the symptom from BUG-finalize-race where files end up
 * "modified" instead of cancelling cleanly), reset dev to the post-merge
 * HEAD so the tree is clean and the stash entry is preserved for manual
 * recovery.
 */
export function restoreDevFromStash(
  repoRoot: string,
  stashLabel: string,
  mergeHead: string,
): void {
  // Find the stash ref by message; we can't rely on `stash@{0}` because
  // other agents may push stashes between our push and pop.
  const list = Bun.spawnSync(["git", "-C", repoRoot, "stash", "list"], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines = list.stdout.toString().split("\n");
  const match = lines.find((line) => line.includes(stashLabel));
  if (!match) {
    log("error", `stash '${stashLabel}' not found — restore manually with 'git stash list'`);
    process.exit(1);
  }
  const stashRef = match.split(":")[0]!.trim();
  const pop = Bun.spawnSync(["git", "-C", repoRoot, "stash", "pop", stashRef], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (pop.exitCode === 0) {
    log("success", `Restored stash '${stashLabel}'`);
    return;
  }

  // Pop failed (conflict with post-merge tree). Roll dev back to the
  // post-merge HEAD so the checkout is clean and the stash entry is
  // preserved. Without this, files end up in "modified" state and the
  // user's pre-merge work disappears into the stash entry.
  log("warn", `stash pop conflicted — resetting dev to post-merge HEAD and preserving stash`);
  raw(`  Stash output: ${pop.stderr.toString().trim()}`);
  const reset = Bun.spawnSync(["git", "-C", repoRoot, "reset", "--hard", mergeHead], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (reset.exitCode !== 0) {
    log("error", `failed to reset dev to ${mergeHead} after stash pop failure`);
    raw(`  Stderr: ${reset.stderr.toString().trim()}`);
    raw(`  Manual recovery:`);
    raw(`    cd ${repoRoot}`);
    raw(
      `    git reset --hard ${mergeHead}     # discard the merge (or 'git reset --hard HEAD~1' if you want to undo it)`,
    );
    raw(`    git stash pop ${stashRef}         # then apply your pre-merge work`);
    process.exit(1);
  }
  log("info", `Dev reset to ${mergeHead.slice(0, 8)}; stash entry '${stashRef}' preserved`);
  raw(`  Your pre-merge work is still on the stash stack as '${stashRef}'.`);
  raw(`  When ready: cd ${repoRoot} && git stash pop ${stashRef}`);
}
/**
 * Resolve the diff-base ref to pass to `bun run check --diff-base`.
 *
 * Why: the `--diff-base` arg scopes coverage + unit gates to that ref's
 * diff vs HEAD (see AGENTS.md). Passing the live target branch means
 * "branch vs current target", which leaks unrelated target-only changes
 * into the gate when the target has moved past the branch's base.
 *
 * This returns the merge-base of `target` and HEAD — a stable ancestor
 * that captures exactly what this branch has contributed since forking.
 *
 * Throws when `git merge-base` exits non-zero (target is not a valid ref
 * or has no common ancestor with HEAD). The previous implementation
 * silently returned `target` on failure, which then crashed
 * the target repo check runner downstream with a confusing stack trace.
 * Production callers always pass a valid `target` (the protected target
 * branch), so this throw is unreachable in normal finalize flows.
 *
 * Exported for unit tests; production callers in `runFinalize` invoke it.
 */
/**
 * Parse the CLI args for `worktree finalize`.
 *
 * Returns a structured object that the finalize() entry point consumes.
 * Exported for unit testing — production callers in `finalize()` invoke it.
 *
 * Validation:
 * - Unknown merge strategy: error log + process.exit(1) (immediate abort).
 *   We can't return an error cleanly here because the CLI surface uses
 *   process.exit directly; tests should mock process.exit if they want
 *   to exercise this branch.
 * - --gates and --skip-gates are mutually exclusive: same exit semantics.
 *
 * The returned values are forward-compatible with the bun.run check
 * CLI: `--gates <csv>` / `--skip-gates <csv>` are passed through to
 * the runner which validates the names itself.
 */
export function parseFinalizeArgs(args: string[]): {
  branch: string;
  mergeStrategy: string;
  force: boolean;
  gatesFilter: string;
  skipGatesFilter: string;
  planGatesFilter: string;
  jobs: string;
} {
  const nonFlagArgs: string[] = [];
  let mergeStrategy = "rebase";
  let force = false;
  let gatesFilter = "";
  let skipGatesFilter = "";
  let planGatesFilter = "";
  let jobs = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--merge-strategy") {
      const value = args[++i];
      if (value !== undefined) mergeStrategy = value;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--gates") {
      gatesFilter = args[++i] || "";
    } else if (arg === "--skip-gates") {
      skipGatesFilter = args[++i] || "";
    } else if (arg === "--plan-gates") {
      planGatesFilter = args[++i] || "";
    } else if (arg === "--jobs") {
      // Check runners default their gate fan-out to 1 (serial) because
      // agents finalize worktrees concurrently and co-scheduled heavy gates
      // OOM the host. `--jobs N` is the explicit opt-in to a faster run.
      jobs = args[++i] || "";
    } else {
      nonFlagArgs.push(arg);
    }
  }
  if (gatesFilter && skipGatesFilter) {
    log("error", "--gates and --skip-gates are mutually exclusive");
    process.exit(1);
  }
  return {
    branch: nonFlagArgs[0] || "",
    mergeStrategy,
    force,
    gatesFilter,
    skipGatesFilter,
    planGatesFilter,
    jobs,
  };
}
