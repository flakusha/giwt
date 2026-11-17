// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt jj` invocation classifier — the err-closed policy seam for the jj
 * passthrough. Mirrors src/git/policy.ts; verb tables live in ./policy-tables.ts.
 */
import { JJ_BLOCK, JJ_BYPASS_TOKENS, JJ_DENY_CONFIG_KEYS, JJ_RO, JJ_RW } from "./policy-tables";

/** User-configurable policy lists ([jj] safe/allow/deny in giwt.toml). */
export interface JjPolicyLists {
  safe: readonly string[];
  allow: readonly string[];
  deny: readonly string[];
}

export const DEFAULT_JJ_POLICY_LISTS: JjPolicyLists = { safe: [], allow: [], deny: [] };

export interface JjVerdict {
  verdict: "pass" | "block";
  reason?: string;
  subcommand: string;
}

const VALUE_GLOBALS = new Set(["-R", "--repository"]);

function configKey(pair: string): string {
  const eq = pair.indexOf("=");
  return (eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
}

function deniedConfigKey(key: string): boolean {
  return JJ_DENY_CONFIG_KEYS.some((prefix) => key.startsWith(prefix));
}

function block(sub: string, reason: string): JjVerdict {
  return { verdict: "block", reason, subcommand: sub };
}

/** Classify one raw `jj` argv (post `giwt jj` prefix). Err-closed. */
export function classifyJjInvocation(
  args: readonly string[],
  lists: JjPolicyLists = DEFAULT_JJ_POLICY_LISTS,
): JjVerdict {
  let base = 0;
  while (base < args.length && args[base] === "--") base++;

  // Bypass flags are refused anywhere — including behind a value global.
  const bypass = args.find((tok) =>
    JJ_BYPASS_TOKENS.some((t) => tok === t || tok.startsWith(`${t}=`))
  );
  if (bypass !== undefined) return block("", `${bypass} bypasses giwt jj policy`);

  const cmd: string[] = [];
  for (let i = base; i < args.length; i++) {
    const tok = args[i];
    if (tok === undefined) break;
    const sub = cmd[0] ?? "";

    if (tok === "--config-file" || tok.startsWith("--config-file=")) {
      return block(sub, "--config-file is refused (rebinds signing/immutability/hooks)");
    }

    if (tok === "--config") {
      const pair = args[i + 1];
      if (pair !== undefined) {
        const key = configKey(pair);
        if (deniedConfigKey(key)) {
          return block(sub, `--config ${key} is refused (policy/identity/code-exec key)`);
        }
        i++;
      }
      continue;
    }
    if (tok.startsWith("--config=")) {
      const key = configKey(tok.slice("--config=".length));
      if (deniedConfigKey(key)) {
        return block(sub, `--config ${key} is refused (policy/identity/code-exec key)`);
      }
      continue;
    }

    if (tok.startsWith("-")) {
      if (VALUE_GLOBALS.has(tok)) {
        const value = args[i + 1];
        if (value !== undefined) i++;
      }
      continue;
    }
    cmd.push(tok);
  }

  const first = cmd[0];
  if (first === undefined) return block("", "no jj subcommand given");

  if (lists.deny.includes(first)) {
    return block(first, `jj ${first} is listed in [jj] deny (repo giwt.toml policy)`);
  }

  for (let n = cmd.length; n >= 1; n--) {
    const key = cmd.slice(0, n).join(" ");
    if (JJ_BLOCK[key] === true) {
      return block(first, `jj ${key} is destructive/unrecoverable and always blocked`);
    }
  }
  for (let n = cmd.length; n >= 1; n--) {
    const key = cmd.slice(0, n).join(" ");
    if (
      JJ_RO[key] === true
      || JJ_RW[key] === true
      || lists.safe.includes(key)
      || lists.allow.includes(key)
    ) {
      return { verdict: "pass", subcommand: first };
    }
  }

  return block(
    first,
    `jj ${first} is not in the giwt built-in allowlist — add it under [jj] allow in giwt.toml if it is safe`,
  );
}

/** Options-object form of {@link classifyJjInvocation}. */
export interface ClassifyJjArgs {
  args: readonly string[];
  lists?: JjPolicyLists;
}

export function classifyJj({ args, lists }: ClassifyJjArgs): JjVerdict {
  return classifyJjInvocation(args, lists ?? DEFAULT_JJ_POLICY_LISTS);
}
