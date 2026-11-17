// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt pijul` invocation classifier — the err-closed seam the pijul
 * passthrough runs before spawning. Flags are scanned across all argv, so a
 * leading global option cannot hide a policy bypass from the verb tables.
 */
import {
  isDeniedPijulConfigKey,
  PIJUL_BARE_RO,
  PIJUL_BLOCK,
  PIJUL_BYPASS_TOKENS,
  PIJUL_EDITOR_SHAPES,
  PIJUL_IDENTITY_OVERRIDE_TOKENS,
  PIJUL_RO,
  PIJUL_RW,
} from "./policy-tables";

export interface PijulPolicyLists {
  safe: readonly string[];
  allow: readonly string[];
  deny: readonly string[];
}

export const DEFAULT_PIJUL_POLICY_LISTS: PijulPolicyLists = { safe: [], allow: [], deny: [] };

export interface PijulVerdict {
  verdict: "pass" | "block";
  reason?: string;
  subcommand: string;
}

const pass = (subcommand: string): PijulVerdict => ({ verdict: "pass", subcommand });
const block = (reason: string, subcommand: string): PijulVerdict => ({
  verdict: "block",
  reason,
  subcommand,
});

function matchesKey(key: string, sub: string, subArgs: readonly string[]): boolean {
  const parts = key.split(" ");
  if (parts[0] !== sub) return false;
  return parts.slice(1).every((part) => subArgs.includes(part));
}

function longestKey(
  table: Record<string, true>,
  sub: string,
  subArgs: readonly string[],
): string | undefined {
  let best: string | undefined;
  for (const key of Object.keys(table)) {
    if (matchesKey(key, sub, subArgs) && (best === undefined || key.length > best.length)) {
      best = key;
    }
  }
  return best;
}

function hasPositionalId(subArgs: readonly string[]): boolean {
  return subArgs.some((tok) => !tok.startsWith("-") && !tok.includes("="));
}

export function classifyPijulInvocation(
  args: readonly string[],
  lists: PijulPolicyLists = DEFAULT_PIJUL_POLICY_LISTS,
): PijulVerdict {
  const rest = args[0] === "--" ? args.slice(1) : args;
  // Leading global options are part of argv, not the verb. A `--config`
  // payload carries '=' and is skipped, so `--config k=v status` still sees
  // `status` as the verb while the guard below scans the whole argv.
  const subIndex = rest.findIndex((tok) => !tok.startsWith("-") && !tok.includes("="));
  if (subIndex < 0) return block("no pijul subcommand given", "");
  const sub = rest[subIndex]!;
  const subArgs = rest.filter((_, index) => index !== subIndex);

  const bypass = PIJUL_BYPASS_TOKENS.find((tok) => rest.includes(tok));
  if (bypass !== undefined) {
    return block(`${bypass} disables certificate checks — refused by giwt policy`, sub);
  }

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    const key = tok === "--config"
      ? rest[i + 1]?.split("=", 1)[0]
      : tok.startsWith("--config=")
      ? tok.slice("--config=".length).split("=", 1)[0]
      : undefined;
    if (key === undefined) continue;
    if (isDeniedPijulConfigKey(key)) {
      return block(`--config ${key} is refused (err-open override surface)`, sub);
    }
    if (tok === "--config") i += 1;
  }

  if (lists.deny.includes(sub)) {
    return block(`pijul ${sub} is listed in [pijul] deny (repo giwt.toml policy)`, sub);
  }

  const blockKey = longestKey(PIJUL_BLOCK, sub, subArgs);
  if (blockKey !== undefined) {
    return block(`pijul ${blockKey} is destructive/unrecoverable and always blocked`, sub);
  }

  if (sub === "record" || sub === "squash") {
    const override = PIJUL_IDENTITY_OVERRIDE_TOKENS.find((tok) =>
      subArgs.some((arg) => arg === tok || arg.startsWith(`${tok}=`))
    );
    if (override !== undefined) {
      return block(`${override} is refused (identity/timestamp spoofing)`, sub);
    }
  }

  const shape = PIJUL_EDITOR_SHAPES[sub];
  if (shape !== undefined) {
    const explicit = shape.explicitTokens;
    if (
      explicit !== undefined
      && !subArgs.some((arg) =>
        explicit.some((token) => arg === token || arg.startsWith(`${token}=`))
      )
    ) {
      return block(
        `pijul ${sub} requires an explicit message flag (editor paths are refused)`,
        sub,
      );
    }
    if (shape.requiresPositionalId === true && !hasPositionalId(subArgs)) {
      return block(`pijul ${sub} requires an explicit change id (editor list is refused)`, sub);
    }
  }

  if (PIJUL_BARE_RO[sub] === true && subArgs.every((tok) => tok.startsWith("-"))) {
    return pass(sub);
  }
  if (
    longestKey(PIJUL_RO, sub, subArgs) !== undefined
    || longestKey(PIJUL_RW, sub, subArgs) !== undefined
  ) {
    return pass(sub);
  }
  if (lists.safe.includes(sub) || lists.allow.includes(sub)) return pass(sub);

  return block(
    `pijul ${sub} is not in the giwt built-in allowlist — add it under [pijul] allow in giwt.toml if it is safe`,
    sub,
  );
}

export interface ClassifyPijulArgs {
  args: readonly string[];
  lists?: PijulPolicyLists;
}

export function classifyPijul({ args, lists }: ClassifyPijulArgs): PijulVerdict {
  return classifyPijulInvocation(args, lists ?? DEFAULT_PIJUL_POLICY_LISTS);
}
