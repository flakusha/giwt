// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { type CommitInfo, walkRange } from "../history/patch-ids";
import { recordRebaseSkips, skipsPath } from "../history/skips";
import { type RebaseResult, rebaseWithPlanReconciliation } from "../plan/reconcile-conflicts";
import { assertGitAuthorIdentity } from "../utils/author-guard";
import { findWorktree, type WorktreeConfig } from "../utils/config";
import { gitSync, isolatedGitEnv, isProtected } from "../utils/git";
import { log, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";
import { scopedSignFlags } from "./scoped-reconcile";

/** One-line summary of strict-superset auto-resolutions, if any occurred. */
function reportAutoResolved(result: RebaseResult): void {
  if (result.autoResolved.length === 0) return;
  log(
    "info",
    `Auto-resolved ${result.autoResolved.length} conflict(s) by strict superset: ${
      result.autoResolved.join(", ")
    }`,
  );
}

const REBASE_USAGE = "  Usage: giwt rebase <branch> [onto] [--autostash] [--skip-note <text>]";

/** Flags: --autostash anywhere; --skip-note <text> (operator reason for
 *  skips this run); unknown flags and bare --skip-note refuse with the
 *  usage line, exactly like every other rebase input error. */
function parseRebaseFlags(
  args: string[],
): { autostash: boolean; skipNote: string | undefined; positionals: string[]; } {
  let autostash = false;
  let skipNote: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--autostash") autostash = true;
    else if (arg === "--skip-note" || arg.startsWith("--skip-note=")) {
      skipNote = arg === "--skip-note" ? args[++i] : arg.slice("--skip-note=".length);
      if (skipNote === undefined || skipNote === "") {
        log("error", "--skip-note requires a reason");
        raw(REBASE_USAGE);
        process.exit(1);
      }
    } else if (arg.startsWith("--")) {
      log("error", `unknown flag '${arg}'`);
      raw(REBASE_USAGE);
      process.exit(1);
    } else positionals.push(arg);
  }
  return { autostash, skipNote, positionals };
}

export async function rebase(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { autostash, skipNote, positionals } = parseRebaseFlags(args);

  const [branch, onto] = positionals;
  const target = onto || config.settings.branches.root;

  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt rebase <branch> [onto]");
    process.exit(1);
  }

  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot rebase protected branch '${branch}'`);
    process.exit(1);
  }

  // Target guard applies to EXPLICITLY named targets only. The no-onto form
  // defaults to branches.root — the integration branch every feature rebases
  // onto — and on default configs that root is itself protected, so a
  // blanket guard rejected the documented default form every time
  // (BUG-rebase-default-target-is-the-root-branch-which-is-also-prote).
  // Hand-typing a protected branch stays refused: that is the history
  // rewrite the guard exists to block, and the default target is by
  // construction never the source branch (self-rebase guard below).
  if (
    onto !== undefined
    && isProtected(target, config.settings.branches.protected)
  ) {
    log("error", `cannot rebase onto protected branch '${target}'`);
    process.exit(1);
  }

  if (target === branch) {
    log("error", `cannot rebase '${branch}' onto itself`);
    process.exit(1);
  }

  const wtPath = findWorktree(branch, config);
  if (!wtPath) {
    log("error", `no worktree found for branch '${branch}'`);
    raw(
      `  Next: create it with 'giwt new-branch ${branch} [base]', then re-run; plain branches cannot be rebased this way.`,
    );
    process.exit(1);
  }

  // Verify target branch exists
  try {
    gitSync(config.repoRoot, "rev-parse", "--verify", target);
  } catch {
    log("error", `target branch '${target}' does not exist`);
    process.exit(1);
  }

  // Check worktree clean. Untracked files are deliberately not probed: they
  // cannot block a rebase (`git diff` ignores them) and git's autostash
  // stashes tracked changes only, so they are left untouched either way.
  if (!autostash) {
    const dirty = Bun.spawnSync(["git", "-C", wtPath, "diff", "--quiet"], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const staged = Bun.spawnSync(["git", "-C", wtPath, "diff", "--cached", "--quiet"], {
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
      log("error", `uncommitted changes in worktree '${branch}' (${wtPath})`);
      raw(`  cd ${wtPath} && git add -A && git commit -m 'feat: ...'`);
      raw(`  cd ${wtPath} && git stash`);
      raw(
        "  Or rerun with --autostash to stash and restore tracked changes around the rebase",
      );
      process.exit(1);
    }
  }

  log("info", `Rebasing '${branch}' onto '${target}'...`);

  // Guard: the rebase replay rewrites history with the worktree's config
  // identity as committer (GPG signs the committer, not the author) — refuse
  // a tampered repo author before any git mutation (see utils/author-guard).
  assertGitAuthorIdentity({
    cwd: wtPath,
    expectedEmail: config.agentGpgEmail ?? "",
    args,
    source: "rebase",
  });

  // Skip-ledger inputs, captured BEFORE any git mutation: the pre-rebase
  // head (recovery pointer) and the replay-order range inventory. The
  // post-rebase diff against this walk is what identifies skips.
  const preHead = gitSync(wtPath, "rev-parse", "HEAD").trim();
  const pre = walkRange({ root: wtPath, range: `${target}..HEAD`, noMerges: true });

  const result = rebaseWithPlanReconciliation(
    wtPath,
    target,
    config.settings.paths.planDir,
    config.settings.paths.tickets,
    scopedSignFlags(config.agentGpgKeyId),
    autostash,
  );

  reportAutoResolved(result);

  if (result.exitCode !== 0) {
    if (result.output.trim()) raw(result.output.trimEnd());
    log("error", `rebase failed — resolve conflicts in ${wtPath}`);
    raw(`  Then: cd ${wtPath} && git rebase --continue`);
    raw(`  Or:   cd ${wtPath} && git rebase --abort`);
    process.exit(1);
  }

  recordSkipLedger({ config, branch, target, wtPath, preHead, pre, skipNote });

  log("success", `Rebased '${branch}' onto '${target}'`);
}

/**
 * Diff the finished replay against the pre-rebase walk and append one
 * durable ledger record per skipped commit. The DETECTED reason is
 * always recorded; --skip-note adds the operator's justification.
 * Appends are announced (never silent) — a skip without a trail is the
 * bug this ledger exists to fix — and mirrored into the run's events.
 */
function recordSkipLedger(
  opts: {
    config: WorktreeConfig;
    branch: string;
    target: string;
    wtPath: string;
    preHead: string;
    pre: CommitInfo[];
    skipNote: string | undefined;
  },
): void {
  const post = walkRange({
    root: opts.wtPath,
    range: `${opts.target}..HEAD`,
    noMerges: true,
  });
  const records = recordRebaseSkips({
    config: opts.config,
    branch: opts.branch,
    target: opts.target,
    preHead: opts.preHead,
    pre: opts.pre,
    post,
    ...(opts.skipNote !== undefined ? { note: opts.skipNote } : {}),
  });
  if (records.length === 0) return;
  const summary = records.map((r) => `${r.sha.slice(0, 7)} (${r.reason.detected})`).join(", ");
  log("warn", `skipped ${records.length} commit(s) — ledger: ${summary}`);
  activeRun()?.event(
    "skips",
    "warn",
    `${records.length} skip(s) recorded to ${skipsPath(opts.config)}`,
  );
}
