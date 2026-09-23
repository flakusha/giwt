#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * giwt — git worktree / commit / GPG / git-issue management CLI.
 *
 * Bun-only tooling: relies on Bun.spawnSync, Bun.file, and Bun test
 * throughout. TODO(env): add a node shim layer only if a node target lands;
 * every env-specific call site lives under src/commands/ and src/utils/.
 *
 * Command dispatch is built on Optique: one `command()` parser per
 * subcommand with a greedy `passThrough()` tail, so each handler keeps
 * receiving its raw argument array (string[]) exactly as before the
 * Optique migration. Help/version/unknown-command handling, usage text,
 * and parse-error exit codes come from @optique/run's `run()`.
 *
 * All commands are registered here and delegated to ./commands/ modules.
 */

import { object, or } from "@optique/core/constructs";
import { text } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { command, constant, passThrough } from "@optique/core/primitives";
import { run } from "@optique/run";
import pkg from "../package.json" with { type: "json" };
import { abort } from "./commands/abort";
import { agentMerge } from "./commands/agent-merge";
import { attach } from "./commands/attach";
import { attachDir } from "./commands/attach-dir";
import { execute as branchesCmd } from "./commands/branches";
import { execute as cleanupCmd } from "./commands/cleanup";
import { comment } from "./commands/comment";
import { commit } from "./commands/commit";
import { commitWt } from "./commands/commit-wt";
import { execute as createCmd } from "./commands/create";
import { execute as diffCmd } from "./commands/diff";
import { doctor } from "./commands/doctor";
import { edit } from "./commands/edit";
import { finalize } from "./commands/finalize";
import { gi } from "./commands/gi";
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
import { ticket } from "./commands/ticket";
import { runGpgUnlock } from "./gpg-unlock";
import { isNoColor } from "./utils/colors";
import { loadConfig, type WorktreeConfig } from "./utils/config";
import { assertNotInWorktree, gitSyncQuiet } from "./utils/git";
import { appendLedger, extractSayArgs, LEDGER_SILENT_COMMANDS } from "./utils/ledger";
import { log, raw, setOutputFormat } from "./utils/output";
import { beginRun } from "./utils/runlog";

interface CommandHandler {
  description: string;
  run: (args: string[], config: WorktreeConfig) => Promise<void>;
}

/**
 * Per-command help bodies for `giwt <cmd> --help` / `giwt help <cmd>`.
 * Handlers parse their own args (Optique passthrough), so the real flag
 * surface lives here; Optique only knows the generic `[[...]]` synopsis.
 * Each entry: usage line, then flag docs.
 */
const USAGE: Record<string, string> = {
  "abort": "[--dry-run]\n  --dry-run   report the recovery plan without mutating anything",
  "agent-merge":
    "<branch> [...]\n  alias for finalize — delegates all args (--merge-strategy, --force, --gates, --skip-gates)",
  "attach": "<ID> <FILE>\n  <ID>     issue id\n  <FILE>   file to attach as comment",
  "attach-dir": "<ID> <DIR>\n  <ID>    issue id\n  <DIR>   directory of files to attach",
  "branches": "",
  "cleanup": "",
  "comment":
    "<ID> <message...>\n  <ID>    issue id\n  rest    forwarded verbatim to git issue comment (e.g. -m \"text\")",
  "commit":
    "[-F <file>|--message-file <file>] \"<type>(scope): <description>\"\n  -F, --message-file <path>   read the message from file ('-' = stdin)",
  "commit-wt":
    "<branch> [-F <file>|--message-file <file>] \"<message>\"\n  <branch>                    worktree branch to commit in\n  -F, --message-file <path>   read the message from file ('-' = stdin)",
  "create": "<branch>\n  <branch>   existing branch to check out as a worktree",
  "diff": "<branch>\n  <branch>   worktree branch to diff against the root branch",
  "doctor":
    "[--apply] [--tool <csv>] [--root <dir>] | check [--json] [--checks <csv>] [--jobs <n>] [--root <dir>]\n  --apply             write configs + apply git config (default: dry-run)\n  --tool <csv>        restrict to specific tool ids\n  check               run repo-health checks (lint, typecheck, tests, knip, jscpd, todo)\n  --json              (check only) machine-readable report\n  --checks <csv>      (check only) restrict to specific check ids\n  --jobs <n>          (check only) max concurrent checks (default: [doctor] jobs, 4)\n  --root <dir>        override project root (default: worktreeRoot)",
  "edit":
    "<ID> [git-issue edit options...]\n  <ID>    issue id\n  rest    forwarded verbatim to git issue edit (--label/--assignee/--priority ...)",
  "finalize":
    "<branch> [--merge-strategy rebase|squash|direct] [--force] [--gates <csv>] [--skip-gates <csv>] [--plan-gates <csv>]\n  --merge-strategy <m>   merge mode\n  --force, -f            skip gates/tests, allow direct merge\n  --gates <csv>          run only these gates\n  --skip-gates <csv>     run all but these (mutually exclusive with --gates)\n  --plan-gates <csv>     run giwt plan validate with these gates before merge",
  "gi":
    "<git-issue args...>\n  forwarded verbatim to git issue; issue-taking subcommands want the id first (show/edit/state <id> ...)\n  git-issue has no close command; close with: giwt gi state <id> --close",
  "gpg-unlock": "",
  "gripe":
    "[--at <branch>] <message...>\n  --at <branch>   branch/agent the gripe targets (--at=<branch> also accepted)",
  "issues":
    "[--all|-a] [--format <f>|-f <f>]\n  --all, -a          show all issues (default: first 50)\n  --format, -f <f>   git-issue ls format",
  "ledger":
    "[--last N] [--json]\n  --last <N>   show only the last N records (--last=N also accepted)\n  --json       machine-readable output",
  "list": "",
  "merge":
    "<branch> <source>\n  <branch>   target worktree branch\n  <source>   branch merged into it",
  "new":
    "<branch> [base]\n  <branch>   new branch name\n  [base]     base ref (default: root branch)",
  "plan":
    "<subcommand> [flags]\n  backlog-sync  sync .plan/backlog/ index ↔ tier files (--fix, --verbose)\n  code-map      build/check/query reverse code→plan index (--check, --find <path>)\n  gen-docs      generate .plan/epics-index.md from .plan/epics/ (--check)\n  check-links   validate internal markdown links + TASK refs\n  validate      comprehensive .plan/ validation (--gates <csv>, --skip-gates <csv>, --fix, --json)\n  status        show .plan/ health summary",
  "prs": "",
  "rebase":
    "<branch> [onto]\n  <branch>   worktree branch\n  [onto]     target ref (default: root branch)",
  "remove": "<branch>\n  <branch>   worktree branch to remove",
  "report": "",
  "runs":
    "[--last N] [--json]\n  --last <N>   show only the last N runs (--last=N also accepted)\n  --json       machine-readable output",
  "search": "<pattern>\n  <pattern>   git-issue search text",
  "show": "<ID>\n  <ID>   issue id",
  "sign": "<branch>\n  <branch>   worktree branch to configure GPG signing for",
  "state":
    "<ID> <open|closed>\n  <ID>      issue id\n  <state>   open|closed (other values become --state=<state>)",
  "status": "[branch]\n  [branch]   optional branch (default: current)",
  "sync":
    "[--fix] [--import] [--import-back] [--verbose]\n  --fix           apply fixes, not just report\n  --import        with --fix: create issues for plan-only .md files\n  --import-back   with --fix: generate .md + index for foreign issues\n  --verbose       verbose output",
  "ticket":
    "<TYPE> <title> [body] [--label X] [--priority X] [--epic X] [--effort X] [--tag X]\n  <TYPE>          BUG|FEAT|FIX|IDEA|TASK|SOL|INFRA\n  --label <X>     add label (repeatable)\n  --priority <X>  low|medium|high|critical\n  --epic <X>      epic name\n  --effort <X>    Small|Medium|Large|XL\n  --tag <X>       add tag (repeatable)",
};

const commands: Record<string, CommandHandler> = {
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
  "cleanup": {
    description: "Remove stale worktrees for deleted branches",
    run: cleanupCmd,
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
  "plan": {
    description: "Plan tooling — backlog sync, code map, docs, link check, validate",
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
    description: "Remove specific worktree",
    run: removeCmd,
  },
  "report": {
    description: "Aggregate check-report status across worktrees",
    run: report,
  },
  "runs": {
    description: "List recent run records (.tmp scratchpad)",
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
  "ticket": {
    description: "Create ticket file + git issue",
    run: ticket,
  },
};

/**
 * One Optique subcommand per registered handler. The handler rides along
 * as a `constant()` and the greedy `passThrough()` captures every
 * remaining token verbatim, preserving the pre-Optique contract that
 * handlers own their argument parsing.
 */
function subcommand(name: string, def: CommandHandler) {
  return command(
    name,
    object({
      action: constant(def.run),
      args: withDefault(passThrough({ format: "greedy" }), [] as string[]),
    }),
    { description: [text(def.description)] },
  );
}

/** `or()` accepts at most 15 branches — nest groups for the full set. */
function buildParser() {
  const entries = Object.entries(commands).map(([name, def]) => subcommand(name, def));
  const groups: typeof entries[] = [];
  for (let i = 0; i < entries.length; i += 15) {
    groups.push(entries.slice(i, i + 15));
  }
  return or(...groups.map((group) => or(...group)));
}

/**
 * Commands that mutate worktree layout (create/rebase/remove/merge trees).
 * They must run from the main repo root — the guard is applied centrally
 * here so new commands cannot forget it. `finalize`/`agent-merge` are the
 * documented exemptions (they resolve the worktree from a branch argument).
 */
const ROOT_ONLY_COMMANDS: Record<string, true> = {
  cleanup: true,
  create: true,
  merge: true,
  new: true,
  rebase: true,
  remove: true,
};

/** Detailed help for one command; body comes from USAGE when present. */
function printCommandHelp(name: string, def: CommandHandler): void {
  raw(`Usage: giwt ${name}${USAGE[name] ? ` ${USAGE[name].split("\n")[0]}` : " [[...]]"}`);
  raw(`  ${def.description}`);
  if (USAGE[name]) {
    raw(USAGE[name].split("\n").slice(1).join("\n"));
  }
  raw("Options: -h, --help  Show this help");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  // Preserve the pre-Optique contract: bare `giwt` shows help and exits 0.
  // Optique's `help` command provides the same output for `giwt help`.
  const args = argv.length === 0 ? ["help"] : argv;
  const cmdName = args[0]!;

  // `giwt help <cmd>` prints the command's real usage before Optique's
  // generic help parser sees it.
  if (cmdName === "help" && args.length > 1) {
    const target = commands[args[1]!];
    if (target) {
      printCommandHelp(args[1]!, target);
      return;
    }
  }

  // Parse errors, --help/--version, and `giwt help` exit inside run().
  const handler = await run(buildParser(), {
    programName: "giwt",
    version: pkg.version,
    description: [text("git worktree / commit / GPG / git-issue management CLI (bun-only)")],
    help: "both",
    args,
    colors: !isNoColor(),
  });

  // `giwt <cmd> --help` / `-h`: handlers own their flags via passthrough,
  // so intercept the help request here instead of feeding it to them.
  if (handler.args[0] === "--help" || handler.args[0] === "-h") {
    printCommandHelp(cmdName, commands[cmdName]!);
    return;
  }

  const config = await loadConfig();
  if (ROOT_ONLY_COMMANDS[cmdName]) {
    assertNotInWorktree(cmdName);
  }

  // Agent ledger: every run leaves one compact record (default message +
  // optional --say context). Say-flags are stripped before dispatch so
  // subcommands never see them.
  const { cleanArgs, said } = extractSayArgs(handler.args);
  // Logger format from settings ([output].format; env GIWT_OUTPUT wins at
  // module load). Applied before any command output, including run records.
  setOutputFormat(config.settings.output.format);
  // An explicit --json flag is the most specific machine-output request:
  // it forces a machine format so banners/log traffic (including the
  // run-record announcement) move to stderr and stdout carries only the
  // raw() payload. See FIX-json-output-polluted-by-run-record-announcement.
  if (cleanArgs.includes("--json")) setOutputFormat("json");
  const silent = LEDGER_SILENT_COMMANDS[cmdName] === true;
  // Resolved branch: one `git branch --show-current` shared by both
  // evidence records. Never derived from args — a positional can be a
  // subcommand (`doctor check`) or absent (`sync`); "" on detached HEAD.
  // Silent commands record neither, so they skip the git call entirely.
  const branch = silent ? "" : gitSyncQuiet(config.worktreeRoot, "branch", "--show-current");
  // Run record first: the location is announced BEFORE the command runs,
  // and every later step can attach captures/events to it.
  const runRec = silent ? null : beginRun(config, cmdName, cleanArgs, said, branch);
  if (!silent) {
    appendLedger(config.treeDir, cmdName, cleanArgs, said, branch);
  }

  try {
    await handler.action(cleanArgs, config);
    // Handlers may set process.exitCode instead of exiting (doctor check
    // keeps piped JSON intact that way) — record the real code.
    runRec?.finish(typeof process.exitCode === "number" ? process.exitCode : 0);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", msg);
    runRec?.finish(1);
    process.exit(1);
  }
}

// Allow direct execution
if (import.meta.main) {
  await main();
}
