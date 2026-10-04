#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-command help bodies for `giwt <cmd> --help` / `giwt help <cmd>`.
 * Handlers parse their own args (Optique passthrough), so the real flag
 * surface lives here; Optique only knows the generic `[[...]]` synopsis.
 * Each entry: usage line, then flag docs.
 */
export const USAGE: Record<string, string> = {
  "abort": "[--dry-run]\n  --dry-run   report the recovery plan without mutating anything",
  "agent-merge":
    "<branch> [...]\n  alias for finalize — delegates all args (--merge-strategy, --force, --gates, --skip-gates)",
  "attach": "<ID> <FILE>\n  <ID>     issue id\n  <FILE>   file to attach as comment",
  "attach-dir": "<ID> <DIR>\n  <ID>    issue id\n  <DIR>   directory of files to attach",
  "backlog": "<sync> [flags]\n  sync   sync .plan/backlog/ index ↔ tier files (--fix, --verbose)",
  "branches": "",
  "clean":
    "[--dry-run] [--apply] [--json|--toml|--emoji] [--verbose]\n  --dry-run   print the prune plan per class (default; nothing is deleted)\n  --apply     run the prune and report bytes freed\n  --json      machine-readable plan/result on stdout (--toml/--emoji also supported)\n  --verbose   list every candidate path, not just per-class totals",
  "cleanup": "",
  "tmp":
    "[--dry-run] [--apply] [--json|--toml|--emoji] [--verbose] [--max-age-hours <n>]\n  --dry-run          analysis + prune plan (default; nothing is deleted)\n  --apply            delete gated stale test-fixture candidates\n  --max-age-hours n  age floor override (settings: [tmp] max_age_hours, default 6)\n  Gates: [tmp] prefixes allowlist, current-user ownership, plain dir/file only,\n  allowed temp roots only (/tmp, $TMPDIR) — /home and system paths refuse.",
  "docs":
    "<list|show|search|dump> [args...]\n  list            table of doc names and titles (--json supported)\n  show <name>     print a doc with its path header (--json supported)\n  search <term>   case-insensitive line search, name:line:text (--json supported)\n  dump <name>     raw file bytes, pipe-safe (no header, no color)",
  "comment":
    "<ID> <message...>\n  <ID>    issue id\n  rest    forwarded verbatim to git issue comment (e.g. -m \"text\")",
  "commit":
    "[-F <file>|--message-file <file>] \"<type>(scope): <description>\" [--on-protected]\n  -F, --message-file <path>   read the message from file ('-' = stdin)\n  --on-protected              required when the current branch is protected",
  "commit-wt":
    "<branch> [-F <file>|--message-file <file>] \"<message>\" [--on-protected]\n  <branch>                    worktree branch (or protected branch with --on-protected)\n  -F, --message-file <path>   read the message from file ('-' = stdin)\n  --on-protected              commit directly in the main checkout of a protected branch",
  "create": "<branch>\n  <branch>   existing branch to check out as a worktree",
  "diff": "<branch>\n  <branch>   worktree branch to diff against the root branch",
  "doctor":
    "[--apply] [--tool <csv>] [--root <dir>] | check [--json|--toml|--emoji] [--checks <csv>] [--jobs <n>] [--timeout <ms>] [--root <dir>] | scratchpad [--json] [--root <dir>]\n  --apply             write configs + apply git config (default: dry-run)\n  --tool <csv>        restrict to specific tool ids\n  check               run repo-health checks (lint, typecheck, tests, knip, jscpd, todo, leaks)\n  scratchpad          scratchpad bloat report (shortcut for `check --checks scratchpad`; shares --json/--root)\n  --json              (check only) machine-readable report (--toml/--emoji also supported)\n  --checks <csv>      (check only) restrict to specific check ids\n  --jobs <n>          (check only) max concurrent checks (default: [doctor] jobs, 1)\n  --timeout <ms>      (check only) per-check subprocess budget; exceeded = killed check (default: [doctor] timeout_ms, 120000)\n  --root <dir>        override project root (default: worktreeRoot)",
  "edit":
    "<ID> [git-issue edit options...]\n  <ID>    issue id\n  rest    forwarded verbatim to git issue edit (--label/--assignee/--priority ...)",
  "finalize":
    "<branch> [--merge-strategy rebase|squash|direct] [--force] [--gates <csv>] [--skip-gates <csv>] [--plan-gates <csv>] [--jobs <n>]\n  --merge-strategy <m>   merge mode\n  --force, -f            skip gates/tests, allow direct merge\n  --gates <csv>          run only these gates\n  --skip-gates <csv>     run all but these (mutually exclusive with --gates)\n  --plan-gates <csv>     run giwt plan validate with these gates before merge\n  --jobs <n>             gate concurrency for the check step (check runners\n                         default to 1; raise it to trade memory for speed)",
  "gi":
    "<git-issue args...>\n  forwarded verbatim to git issue; issue-taking subcommands want the id first (show/edit/state <id> ...)\n  git-issue has no close command; close with: giwt gi state <id> --close",
  "git":
    "[--] <git args...>\n  Safety-gated git passthrough — the harness reroutes raw `git` here. Every invocation\n  is classified before git runs: read-only and recoverable mutations pass, destructive\n  shapes (reset --hard, clean, force push, checkout/restore path discard, branch -D,\n  stash drop/clear, reflog expire, filter-branch, tag -d, gc, ...), gpg bypass\n  (--no-gpg-sign, -c commit.gpgsign=false, credential.*/core.hooksPath overrides),\n  config writes, editor-requiring commits, and unknown subcommands are refused.\n  Full output is captured to the run record (git-output.txt); rtk (if installed)\n  prints compact output for status/log/diff/show. Exit code is git's.\n  Config: [git] rtk=auto|on|off, safe=[...], allow=[...], deny=[...], classify=builtin",
  "gpg-unlock": "",
  "gripe":
    "[--at <branch>] <message...>\n  --at <branch>   branch/agent the gripe targets (--at=<branch> also accepted)",
  "issues":
    "[--all|-a] [--state <open|closed|all>|-s <v>] [--format <f>|-f <f>]\n  --all, -a                show all issues (default: first 50, with a truncation notice)\n  --state, -s <v>          filter by state: open|closed|all (default: open; --state=<v> also accepted)\n  --format, -f <f>         git-issue ls format",
  "ledger":
    "[--last N] [--json]\n  --last <N>   show only the last N records (--last=N also accepted)\n  --json       machine-readable output",
  "list":
    "[--json|--toml|--emoji]\n  --json      worktree records: branch, path, head, ahead/behind, stale\n  --toml      same records as TOML (items array)\n  --emoji     one 📁 line per worktree",
  "merge":
    "<branch> <source>\n  <branch>   target worktree branch\n  <source>   branch merged into it",
  "new":
    "<branch> [base] [--scope <text>] [--tickets <csv>]\n  <branch>     new branch name\n  [base]       base ref (default: root branch)\n  --scope <t>  short explanation, persisted as **Scope:** header lines\n  --tickets <csv>  ticket ids (extid/slug/.md) copied in as In Progress + first commit; finalize closes them pre-merge and reconciles the plan post-merge",
  "plan":
    "<subcommand> [flags]\n  code-map      build/check/query reverse code→plan index (--check, --find <path>)\n  gen-docs      generate .plan/epics-index.md from .plan/epics/ (--check)\n  check-links   validate internal markdown links + TASK refs\n  validate      comprehensive .plan/ validation (--gates <csv>, --skip-gates <csv>, --fix, --diff-base <ref>, --json)\n  status        .plan/ health summary (--tickets: per-ticket Status + unticked acceptance counts; --json|--toml|--emoji)",
  "prs": "",
  "rebase":
    "<branch> [onto]\n  <branch>   worktree branch\n  [onto]     target ref (default: root branch)",
  "remove":
    "<branch> [--branch-only] [--force]\n  <branch>        worktree branch to remove\n  --branch-only   delete the branch even when no worktree exists\n  --force         with --branch-only: delete even when unmerged (prints recovery SHA)",
  "report": "",
  "runs":
    "[triage <run>] [diff <runA> <runB>] [--last N] [--json|--toml|--emoji]\n  triage <run>  failing blocks from a run's captured test.log (run dir path or id prefix)\n  diff <a> <b>  set-diff failure identities between two runs: new / fixed (report, never gates)\n  --last <N>    show only the last N runs (--last=N also accepted)\n  --json        machine-readable records (--toml/--emoji also supported)",
  "search":
    "<pattern> [--json|--toml|--emoji]\n  <pattern>   git-issue search text\n  --json      array of hit records {hash, state, title, extid}\n  --toml      [[items]] array-of-tables\n  --emoji     one line per hit: status glyph + extid/hash + title",
  "show":
    "<ID> [--json|--toml|--emoji]\n  <ID>        issue id (extid, case-insensitive, or hash)\n  --json      single record {extid, hash, state, title, labels?, priority?, body?}\n  --toml      {value = record}\n  --emoji     one line: status glyph + extid/hash + title",
  "sign": "<branch>\n  <branch>   worktree branch to configure GPG signing for",
  "state":
    "<ID> <open|closed>\n  <ID>      issue id\n  <state>   open|closed (other values become --state=<state>)",
  "status": "[branch]\n  [branch]   optional branch (default: current)",
  "sync":
    "[--fix] [--import] [--import-back] [--verbose] [--diff-base <ref>]\n  --fix           apply fixes, not just report\n  --import        with --fix: create issues for plan-only .md files\n  --import-back   with --fix: generate .md + index for foreign issues\n  --verbose       verbose output\n  --diff-base <ref>  scope report/fixes to plan files changed vs this ref",
  "task":
    "<directive...> [flags] — prints an agent task prompt (directive last)\n  <directive...>            task text (positional); conflicts with -m/-F\n  -m, -d, --message, --directive <t>   explicit directive text\n  -F, --file <path>         read directive from file (\"-\" = stdin)\n  -j, --jobs <n>            finalization jobs; 0 = do not finalize (default: CLI default)\n  -a, --agents <n>          subagent budget: 0 none, -1 unbounded, N cap (default: omit)\n  --good <n>, --fast <n>    explicit good/fast subagent split (conflicts with -a 0)\n  -g, --gates <all|csv|prose>  gates to ignore: \"all\" urgent-merge skip, csv -> finalize --skip-gates, prose verbatim\n  --strict                  run the full gate suite (conflicts with -g)\n  --shallow | --deep        research depth (default: agent judgment)\n  -s, --skills <min|max|reasonable>  docs/skills reading mode (default: none beyond the task)\n  -w, --worktree[=name]     open a new worktree first; bare form derives a slug\n  --base <ref>              base ref for the new worktree (implies -w)\n  --tickets <csv>           tickets to attach to the new worktree (implies -w)\n  --follow <t>              \"follow patterns\" directive line (repeatable)\n  --careful <t>             \"be careful about\" directive line (repeatable)\n  --docs <t>                \"check repo docs\" directive line (repeatable)",
  "ticket":
    "<TYPE> <title> [body] [flags] — flags may precede or follow the body\n  close <hash|extid|slug|slug.md>... [--note \"text\"] [--json|--toml|--emoji]\n  copy <hash|name|extid|slug|slug.md>... --to <checkout-path> | --from <checkout-path> [--json|--toml|--emoji]\n  3way <path> [--json|--toml|--emoji]\n  <TYPE>          BUG|FEAT|FIX|IDEA|TASK|SOL|INFRA\n  --label <X>     add label (repeatable)\n  --priority <X>  low|medium|high|critical\n  --epic <X>      epic name\n  --effort <X>    Small|Medium|Large|XL\n  --tag <X>       add tag (repeatable)",
};
