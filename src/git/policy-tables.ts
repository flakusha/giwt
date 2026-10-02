// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Static git-invocation policy tables for `giwt git` — which subcommands
 * pass unconditionally, which are always refused, and where flag-level
 * checks apply. Data only; classification lives in policy.ts.
 *
 * Model (err-closed): a subcommand passes when it is read-only, in the
 * mutating-but-recoverable table, or added by the user's [git] lists;
 * EVERYTHING else is blocked. Built-in blocks are never overridable.
 */

/**
 * Subcommands that never mutate repository state — pass without flag
 * checks (gpg-bypass/-c scans still apply globally).
 */
export const RO_SUBCOMMANDS: Record<string, true> = {
  status: true,
  log: true,
  show: true,
  diff: true,
  "diff-tree": true,
  "diff-files": true,
  "diff-index": true,
  "rev-parse": true,
  "rev-list": true,
  "ls-files": true,
  "ls-tree": true,
  "ls-remote": true,
  "cat-file": true,
  describe: true,
  "name-rev": true,
  "merge-base": true,
  shortlog: true,
  blame: true,
  annotate: true,
  grep: true,
  whatchanged: true,
  "for-each-ref": true,
  "check-ignore": true,
  "check-attr": true,
  "check-mailmap": true,
  "verify-commit": true,
  "verify-tag": true,
  "count-objects": true,
  fsck: true,
  cherry: true,
  "show-branch": true,
  "range-diff": true,
  archive: true,
  "format-patch": true,
  "show-index": true,
  var: true,
  help: true,
  version: true,
};

/**
 * Subcommands that mutate repository state in recoverable ways — pass
 * after their per-subcommand predicate (if any) clears the arguments.
 */
export const RW_SUBCOMMANDS: Record<string, true> = {
  add: true,
  commit: true,
  merge: true,
  rebase: true,
  switch: true,
  checkout: true,
  restore: true,
  stash: true,
  fetch: true,
  pull: true,
  push: true,
  rm: true,
  mv: true,
  apply: true,
  am: true,
  "cherry-pick": true,
  revert: true,
  worktree: true,
  reset: true,
  tag: true,
  branch: true,
  remote: true,
  notes: true,
  config: true,
  init: true,
  clone: true,
  "symbolic-ref": true,
  "update-ref": true,
  replace: true,
  bisect: true,
  "sparse-checkout": true,
  submodule: true,
  bundle: true,
  reflog: true,
};

/**
 * Subcommands refused outright — destructive, unrecoverable, or
 * execution-of-arbitrary-code shapes. Not reachable from [git] allow.
 */
export const BLOCK_SUBCOMMANDS: Record<string, true> = {
  clean: true,
  gc: true,
  maintenance: true,
  "filter-branch": true,
  "filter-repo": true,
  daemon: true,
  "http-backend": true,
  "upload-pack": true,
  "receive-pack": true,
  "fast-import": true,
  "for-each-repo": true,
  hook: true,
  instaweb: true,
  "send-email": true,
};

/**
 * Subcommands whose compact `rtk git` output is trusted for console
 * display (read-only, side-effect free — the display pass re-executes).
 */
export const RTK_DISPLAY_SUBCOMMANDS: Record<string, true> = {
  status: true,
  log: true,
  diff: true,
  show: true,
};

/** `-c` config override keys that are refused regardless of value. */
export const DENY_OVERRIDE_KEYS: readonly string[] = [
  "credential.",
  "core.hookspath",
  "core.sshcommand",
  "gpg.format",
];

/** `-c` config override keys blocked only when set falsy. */
export const GPG_OVERRIDE_KEYS: readonly string[] = ["commit.gpgsign", "tag.gpgsign"];

/** Argument tokens that disable GPG signing — blocked anywhere in argv. */
export const GPG_BYPASS_TOKENS: readonly string[] = ["--no-gpg-sign", "--no-sign"];

const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/** True when a `-c key=value` override is refused. */
export function isDeniedOverride(pair: string): boolean {
  const eq = pair.indexOf("=");
  if (eq < 0) return false;
  const key = pair.slice(0, eq).toLowerCase();
  const value = pair.slice(eq + 1).toLowerCase();
  if (DENY_OVERRIDE_KEYS.some((k) => key.startsWith(k))) return true;
  return GPG_OVERRIDE_KEYS.includes(key) && FALSE_VALUES.has(value);
}

/** True when a `--config-env key=VAR` override is refused (value unreadable). */
export function isDeniedConfigEnv(pair: string): boolean {
  const key = (pair.split("=", 1)[0] ?? "").toLowerCase();
  if (DENY_OVERRIDE_KEYS.some((k) => key.startsWith(k))) return true;
  return GPG_OVERRIDE_KEYS.includes(key);
}
