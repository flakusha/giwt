#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Command registry: one entry per giwt subcommand. `src/cli.ts` builds
 * the Optique parser and dispatch from this table; keep command keys
 * aligned with their src/commands/<key>.ts modules.
 */
import { abort } from "./commands/abort";
import { agentMerge } from "./commands/agent-merge";
import { attach } from "./commands/attach";
import { attachDir } from "./commands/attach-dir";
import { backlog } from "./commands/backlog";
import { execute as branchesCmd } from "./commands/branches";
import { clean } from "./commands/clean";
import { execute as cleanupCmd } from "./commands/cleanup";
import { comment } from "./commands/comment";
import { commit } from "./commands/commit";
import { commitWt } from "./commands/commit-wt";
import { execute as createCmd } from "./commands/create";
import { execute as diffCmd } from "./commands/diff";
import { docs } from "./commands/docs";
import { doctor } from "./commands/doctor";
import { edit } from "./commands/edit";
import { finalize } from "./commands/finalize";
import { gi } from "./commands/gi";
import { gitPassthrough } from "./commands/git";
import { gripe } from "./commands/gripe";
import { issues } from "./commands/issues";
import { ledger } from "./commands/ledger";
import { listWorktrees } from "./commands/list";
import { merge } from "./commands/merge";
import { execute as newBranchCmd } from "./commands/new-branch";
import { plan } from "./commands/plan";
import { execute as prsCmd } from "./commands/prs";
import { rebase } from "./commands/rebase";
import { execute as removeCmd } from "./commands/remove";
import { report } from "./commands/report";
import { runs } from "./commands/runs";
import { search } from "./commands/search";
import { show } from "./commands/show";
import { execute as signCmd } from "./commands/sign";
import { state } from "./commands/state";
import { execute as statusCmd } from "./commands/status";
import { sync } from "./commands/sync";
import { task } from "./commands/task";
import { ticket } from "./commands/ticket";
import { tmp } from "./commands/tmp";
import { runGpgUnlock } from "./gpg-unlock";
import type { WorktreeConfig } from "./utils/config";

export interface CommandHandler {
  description: string;
  run: (args: string[], config: WorktreeConfig) => Promise<void>;
}

export const commands: Record<string, CommandHandler> = {
  "abort": {
    description:
      "Manually recover a finalize that left dev in a bad state (in-progress merge, leftover stash, stale lock)",
    run: abort,
  },
  "commit-wt": {
    description: "GPG-signed commit in worktree",
    run: commitWt,
  },
  "agent-merge": {
    description: "Alias for finalize — merge worktree into current branch and clean up",
    run: agentMerge,
  },
  "attach": {
    description: "Attach file to issue as comment",
    run: attach,
  },
  "attach-dir": {
    description: "Attach all files in directory to issue",
    run: attachDir,
  },
  "branches": {
    description: "List branches with status",
    run: branchesCmd,
  },
  "clean": {
    description: "Age/size-capped pruning of .tmp scratchpad artifacts (dry-run by default)",
    run: clean,
  },
  "cleanup": {
    description: "Remove stale worktrees for deleted branches",
    run: cleanupCmd,
  },
  "tmp": {
    description: "Analyze the machine temp root and prune stale test fixtures (dry-run by default)",
    run: tmp,
  },
  "docs": {
    description: "List, show, search, or dump the repo's markdown docs",
    run: docs,
  },
  "comment": {
    description: "Add comment to issue",
    run: comment,
  },
  "commit": {
    description: "GPG-signed commit on current branch",
    run: commit,
  },
  "create": {
    description: "Create worktree for existing branch",
    run: createCmd,
  },
  "diff": {
    description: "Show diff for worktree branch",
    run: diffCmd,
  },
  "doctor": {
    description:
      "Detect project structure and set up dev tooling (oxlint, biome, knip, jscpd, hooks); `doctor check` runs repo-health checks",
    run: doctor,
  },
  "edit": {
    description: "Edit issue metadata",
    run: edit,
  },
  "finalize": {
    description: "Validate, merge, remove worktree, delete branch",
    run: finalize,
  },
  "gi": {
    description: "Run git-issue command directly",
    run: gi,
  },
  "git": {
    description:
      "Safety-gated git passthrough (harness reroutes raw git here): allowlist + destructive/gpg guard, run-record capture, rtk compact output",
    run: gitPassthrough,
  },
  "gpg-unlock": {
    description: "Warm/verify the GPG agent passphrase cache for agent commits",
    run: async () => runGpgUnlock(),
  },
  "gripe": {
    description: "Vent at another agent on the shared ledger",
    run: gripe,
  },
  "issues": {
    description: "List issues",
    run: issues,
  },
  "ledger": {
    description: "Show recent agent ledger records",
    run: ledger,
  },
  "list": {
    description: "Show all worktrees with status",
    run: listWorktrees,
  },
  "merge": {
    description: "Merge source branch into worktree branch",
    run: merge,
  },
  "new": {
    description: "Create new branch + worktree",
    run: newBranchCmd,
  },
  "backlog": {
    description: "Backlog tooling — sync .plan/backlog/ indexes",
    run: backlog,
  },
  "plan": {
    description: "Plan tooling — code map, docs, link check, validate",
    run: plan,
  },
  "prs": {
    description: "Create worktrees for open PRs",
    run: prsCmd,
  },
  "rebase": {
    description: "Rebase worktree branch onto target",
    run: rebase,
  },
  "remove": {
    description: "Remove specific worktree; --branch-only deletes a bare branch",
    run: removeCmd,
  },
  "report": {
    description: "Aggregate check-report status across worktrees",
    run: report,
  },
  "runs": {
    description: "List run records; triage failures; diff two runs (.tmp scratchpad)",
    run: runs,
  },
  "search": {
    description: "Search issues by text pattern",
    run: search,
  },
  "show": {
    description: "Show issue details and comments",
    run: show,
  },
  "sign": {
    description: "Configure GPG signing for existing worktree",
    run: signCmd,
  },
  "state": {
    description: "Change issue state",
    run: state,
  },
  "status": {
    description: "Show branch sync status",
    run: statusCmd,
  },
  "sync": {
    description: "Sync ticket index with files + git issues",
    run: sync,
  },
  "task": {
    description:
      "Render an agent task prompt: flags -> generic implementation/finalization guidance, user directive last",
    run: task,
  },
  "ticket": {
    description: "Create ticket file + git issue; close/copy/3way subactions",
    run: ticket,
  },
};
