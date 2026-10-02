// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt git` invocation classifier — the stable seam the git passthrough
 * (and, later, a 0-shot LLM classifier behind the same interface) calls
 * before any git process runs. Err-closed: unknown subcommands and
 * unknown global options are blocked, not guessed.
 *
 * Precedence: global-flag scan (incl. `-c` gpg/credential/hook refusals)
 * → [git] deny → BLOCK table → per-subcommand predicate → RO/RW tables
 * → [git] safe/allow → block (unknown).
 */
import { existsSync } from "node:fs";
import {
  BLOCK_SUBCOMMANDS,
  GPG_BYPASS_TOKENS,
  isDeniedConfigEnv,
  isDeniedOverride,
  RO_SUBCOMMANDS,
  RW_SUBCOMMANDS,
} from "./policy-tables";
import { type PredicateCtx, PREDICATES } from "./predicates";

/** User-configurable policy lists ([git] safe/allow/deny in giwt.toml). */
export interface GitPolicyLists {
  /** Extra subcommands treated as read-only. */
  safe: readonly string[];
  /** Extra subcommands treated as mutating-but-recoverable. */
  allow: readonly string[];
  /** Extra subcommands refused outright (wins over safe/allow). */
  deny: readonly string[];
}

export const DEFAULT_POLICY_LISTS: GitPolicyLists = { safe: [], allow: [], deny: [] };

export interface GitVerdict {
  verdict: "pass" | "block";
  /** Human-readable refusal reason; present when verdict === "block". */
  reason?: string;
  /** Subcommand token when identified, else "" (global-flag blocks). */
  subcommand: string;
}

export interface ClassifyOptions extends Partial<PredicateCtx> {}

interface ParsedGlobal {
  /** Subcommand tokens (everything after the global option block). */
  rest: string[];
  /** Block reason from the global scan, if any. */
  error?: string;
}

const VALUE_GLOBALS = new Set(["-C", "--git-dir", "--work-tree", "--namespace"]);
const BOOL_GLOBALS = new Set([
  "--no-pager",
  "-P",
  "--paginate",
  "-p",
  "--no-replace-objects",
  "--literal-pathspecs",
  "--no-optional-locks",
  "--bare",
  "--no-lazy-fetch",
]);
const NO_VALUE_GLOBALS = new Set([
  "--exec-path",
  "--html-path",
  "--man-path",
  "--info-path",
]);

/** Split global option block from subcommand args; refuse unknown globals. */
export function parseGlobalArgs(args: readonly string[]): ParsedGlobal {
  let i = 0;
  while (i < args.length) {
    const tok = args[i]!;
    if (tok === "--") return { rest: args.slice(i + 1) };
    if (tok === "--config-env") {
      const pair = args[i + 1];
      if (pair === undefined) return { rest: [], error: "--config-env requires key=VAR" };
      if (isDeniedConfigEnv(pair)) {
        return { rest: [], error: "--config-env refused for config/gpg/credential/hook keys" };
      }
      i += 2;
      continue;
    }
    if (tok.startsWith("--config-env=")) {
      const pair = tok.slice("--config-env=".length);
      if (isDeniedConfigEnv(pair)) {
        return { rest: [], error: "--config-env refused for config/gpg/credential/hook keys" };
      }
      i += 1;
      continue;
    }
    if (tok[1] === "c") {
      const pair = tok.length > 2 ? tok.slice(2) : args[i + 1];
      if (pair === undefined || !pair.includes("=")) {
        return { rest: [], error: "-c requires key=value" };
      }
      if (isDeniedOverride(pair)) {
        return {
          rest: [],
          error: `-c ${
            pair.split("=", 1)[0]
          } override is refused (config/gpg/credential/hook tampering)`,
        };
      }
      i += tok.length > 2 ? 1 : 2;
      continue;
    }
    const eqIdx = tok.indexOf("=");
    const head = tok.startsWith("--")
      ? (eqIdx >= 0 ? tok.slice(0, eqIdx) : tok)
      : tok.slice(0, 2);
    if (VALUE_GLOBALS.has(head) || NO_VALUE_GLOBALS.has(head)) {
      // `--opt=v` / `-Xv` are self-contained; `--opt v` (VALUE_GLOBALS only)
      // takes the next token; no-value globals consume only themselves.
      const takesNext = eqIdx < 0 && tok.length === head.length && VALUE_GLOBALS.has(head);
      i += takesNext ? 2 : 1;
      continue;
    }
    if (BOOL_GLOBALS.has(tok)) {
      i += 1;
      continue;
    }
    if (tok.startsWith("-")) {
      return { rest: [], error: `unknown global git option '${tok}'` };
    }
    return { rest: args.slice(i) };
  }
  return { rest: [] };
}

const FALLBACK_PATH_EXISTS = (rel: string): boolean => existsSync(rel);

/**
 * Classify one raw `git` argv (post `giwt git` prefix). Pure except the
 * checkout path-existence probe, which callers can inject for tests.
 */
export function classifyGitInvocation(
  args: readonly string[],
  lists: GitPolicyLists = DEFAULT_POLICY_LISTS,
  options: ClassifyOptions = {},
): GitVerdict {
  const ctx: PredicateCtx = {
    pathExists: options.pathExists ?? FALLBACK_PATH_EXISTS,
  };
  const parsed = parseGlobalArgs(args);
  if (parsed.error !== undefined) {
    return { verdict: "block", reason: parsed.error, subcommand: "" };
  }
  const rest = parsed.rest;
  if (rest.length === 0) {
    return { verdict: "block", reason: "no git subcommand given", subcommand: "" };
  }
  const sub = rest[0]!;
  const subArgs = rest.slice(1);

  const denyBlock = `git ${sub} is listed in [git] deny`;
  if (lists.deny.includes(sub)) return { verdict: "block", reason: denyBlock, subcommand: sub };
  if (GPG_BYPASS_TOKENS.some((t) => subArgs.includes(t))) {
    return {
      verdict: "block",
      reason: `${t0(subArgs)} disables GPG signing — giwt requires signed commits`,
      subcommand: sub,
    };
  }
  if (BLOCK_SUBCOMMANDS[sub]) {
    return {
      verdict: "block",
      reason: `git ${sub} is destructive/unrecoverable and always blocked`,
      subcommand: sub,
    };
  }
  const predicate = PREDICATES[sub];
  if (predicate !== undefined) {
    const reason = predicate(subArgs, ctx);
    if (reason !== null) return { verdict: "block", reason, subcommand: sub };
    return { verdict: "pass", subcommand: sub };
  }
  if (RO_SUBCOMMANDS[sub] || lists.safe.includes(sub)) {
    return { verdict: "pass", subcommand: sub };
  }
  if (RW_SUBCOMMANDS[sub] || lists.allow.includes(sub)) {
    return { verdict: "pass", subcommand: sub };
  }
  return {
    verdict: "block",
    reason:
      `git ${sub} is not in the giwt allowlist — add it under [git] allow in giwt.toml if it is safe`,
    subcommand: sub,
  };
}

function t0(args: readonly string[]): string {
  const tok = args.find((a) => GPG_BYPASS_TOKENS.includes(a));
  return tok ?? "--no-gpg-sign";
}
