// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Static pijul-invocation policy tables for `giwt pijul`. Data only;
 * classification lives in policy.ts. Keys are space-joined token sequences:
 * first token is the subcommand, later tokens must appear in the argument
 * tail (so flags such as `--reset` are found wherever they sit in argv).
 */

/** Pure reads (archive only writes a caller-named file). */
export const PIJUL_RO: Record<string, true> = {
  status: true,
  log: true,
  diff: true,
  change: true,
  credit: true,
  list: true,
  dependents: true,
  archive: true,
  "hooks show": true,
  "identity list": true,
  completion: true,
};

/**
 * Container commands whose bare form lists state. The classifier passes
 * these only with no positional sub-op: every real sub-op must be an
 * explicit RO/RW/BLOCK key, otherwise an unknown future sub-op would slip
 * through the bare key and break err-closed.
 */
export const PIJUL_BARE_RO: Record<string, true> = { remote: true, channel: true };

/** Recoverable mutations — pass once the flag-level guards clear. */
export const PIJUL_RW: Record<string, true> = {
  add: true,
  remove: true,
  move: true,
  record: true,
  fork: true,
  pull: true,
  push: true,
  clone: true,
  init: true,
  apply: true,
  squash: true,
  unrecord: true,
  "channel new": true,
  "channel rename": true,
  "channel switch": true,
  "remote default": true,
  "remote delete": true,
  "http-token": true,
  "identity new": true,
  "identity edit": true,
  "identity repair": true,
  "identity prove": true,
  "hooks approve": true,
  "hooks revoke": true,
  "git import": true,
};

/** Always refused: destructive history/worktree ops, credentials, helpers. */
export const PIJUL_BLOCK: Record<string, true> = {
  reset: true,
  "unrecord --reset": true,
  "record --accept-conflict-markers": true,
  "channel delete": true,
  "identity remove": true,
  client: true,
  debug: true,
};

/** Certificate-check bypass tokens — refused anywhere in argv (PJ-1). */
export const PIJUL_BYPASS_TOKENS: readonly string[] = ["-k", "--no-cert-check"];

/** `--config` keys that pass; pijul's override handling is err-open. */
export const PIJUL_ALLOW_CONFIG_KEYS: readonly string[] = [
  "colors",
  "pager",
  "unrecord_changes",
];

/** Empty prefix = catch-all: every key not allowlisted is refused. */
export const PIJUL_DENY_CONFIG_PREFIXES: readonly string[] = [""];

export function isDeniedPijulConfigKey(key: string): boolean {
  if (PIJUL_ALLOW_CONFIG_KEYS.includes(key)) return false;
  return PIJUL_DENY_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Tokens that make an editor-requiring invocation non-interactive. */
export interface PijulEditorShape {
  readonly explicitTokens?: readonly string[];
  readonly requiresPositionalId?: boolean;
}

export const PIJUL_EDITOR_SHAPES: Record<string, PijulEditorShape> = {
  record: { explicitTokens: ["-m", "--message", "--description", "--from-change"] },
  unrecord: { requiresPositionalId: true },
};

/** `--identity <NAME>` is legitimate; these two spoof identity/timestamp. */
export const PIJUL_IDENTITY_OVERRIDE_TOKENS: readonly string[] = ["--author", "--timestamp"];
