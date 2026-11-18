// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Static jj-invocation policy tables for `giwt jj`. Keys are normalized
 * command prefixes (single verb, or space-separated nested verb path); the
 * classifier applies the longest matching prefix. Source of truth:
 * .tmp/research/jj/NOTES.md §6 (incl. audit JJ-1..JJ-3 fold-in).
 */

/** Read-only jj prefixes — safe passthrough (still snapshots the WC). */
export const JJ_RO: Record<string, true> = {
  status: true,
  log: true,
  show: true,
  diff: true,
  interdiff: true,
  evolog: true,
  "op log": true,
  "op diff": true,
  "op show": true,
  "file show": true,
  "file list": true,
  "file annotate": true,
  "file search": true,
  "bookmark list": true,
  "tag list": true,
  "workspace list": true,
  "workspace root": true,
  "git root": true,
  "git colocation status": true,
  "config list": true,
  root: true,
  version: true,
  help: true,
  "util completion": true,
  "util config-schema": true,
  "util diff": true,
  "util markdown-help": true,
};

/**
 * Mutating jj prefixes. Most are recoverable from the op log until
 * `util gc`/`op abandon` prune it. `git push`, the `git remote *` family,
 * `config set|edit` and `util install-man-pages` are NOT op-log reversible —
 * they touch a remote, config files outside the repo, or the filesystem.
 */
export const JJ_RW: Record<string, true> = {
  new: true,
  commit: true,
  describe: true,
  metaedit: true,
  split: true,
  squash: true,
  absorb: true,
  restore: true,
  rebase: true,
  revert: true,
  duplicate: true,
  abandon: true,
  parallelize: true,
  sign: true,
  edit: true,
  next: true,
  prev: true,
  resolve: true,
  "bookmark create": true,
  "bookmark set": true,
  "bookmark move": true,
  "bookmark track": true,
  "bookmark untrack": true,
  "bookmark rename": true,
  "bookmark delete": true,
  "bookmark forget": true,
  "bookmark advance": true,
  "tag set": true,
  "tag delete": true,
  "tag track": true,
  "tag untrack": true,
  "git fetch": true,
  "git export": true,
  "git import": true,
  "git push": true,
  "git remote add": true,
  "git remote remove": true,
  "git remote set-url": true,
  "file chmod": true,
  "file delete": true,
  "file edit": true,
  "file track": true,
  "file untrack": true,
  "workspace add": true,
  "workspace rename": true,
  "workspace update-stale": true,
  run: true,
  "simplify-parents": true,
  converge: true,
  arrange: true,
  "util snapshot": true,
  "op integrate": true,
  "op revert": true,
  undo: true,
  redo: true,
  "config set": true,
  "config edit": true,
  "util install-man-pages": true,
};

/** Refused outright — destructive, store-restructuring, or arbitrary code. */
export const JJ_BLOCK: Record<string, true> = {
  "util gc": true,
  "op abandon": true,
  "op restore": true,
  "workspace remove": true,
  "git init": true,
  "git clone": true,
  "git colocation enable": true,
  "git colocation disable": true,
  bisect: true,
  diffedit: true,
  sparse: true,
  gerrit: true,
  "util backend": true,
  "util exec": true,
  unsign: true,
  fix: true,
  "workspace forget": true,
};

/** Global flags that bypass giwt policy — refused anywhere in argv. */
export const JJ_BYPASS_TOKENS: readonly string[] = [
  "--ignore-immutable",
  "--no-integrate-operation",
  "--at-op",
  "--at-operation",
  "--ignore-changes",
];

/** Known jj global options (0.46 `jj --help`), keyed by option head: `value`
 * means the option consumes the next token. Bypass/config globals are refused
 * by dedicated guards in policy.ts, not by this table. Unknown globals are
 * refused before the subcommand (parity with git's parseGlobalArgs). */
export const JJ_GLOBAL_OPTIONS: Readonly<Record<string, "value" | "bool">> = {
  "-R": "value",
  "--repository": "value",
  "--color": "value",
  "--ignore-working-copy": "bool",
  "--debug": "bool",
  "--quiet": "bool",
  "--no-pager": "bool",
  "-h": "bool",
  "--help": "bool",
  "-V": "bool",
  "--version": "bool",
};

/** `--config` key prefixes refused regardless of value (JJ-2 / JJ-3). */
export const JJ_DENY_CONFIG_KEYS: readonly string[] = [
  "signing.behavior",
  "signing.backend",
  "revset-aliases.",
  "git.private-commits",
  "git.abandon-unreachable-commits",
  "user.name",
  "user.email",
  "fix.tools.",
  "merge-tools.",
  "ui.editor",
  "ui.diff-formatter",
];
