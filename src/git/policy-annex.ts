// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Second-level git-annex classification for `giwt git` — policy.ts
 * dispatches `annex` subcommands here (see the annex tables in
 * policy-tables.ts for the default RO/RW/deny sets).
 */

import type { GitPolicyLists, GitVerdict } from "./policy";
import {
  ANNEX_ALLOW_SUBCOMMANDS,
  ANNEX_DENY_SUBCOMMANDS,
  ANNEX_RO_SUBCOMMANDS,
} from "./policy-tables";

/** First list entry matching `annex` (any op) or the two-token `annex <op>`. */
function findAnnexEntry(list: readonly string[], op: string): string | undefined {
  return list.find((e) => e === "annex" || e === `annex ${op}`);
}

/**
 * Second-level annex classification (sub = "annex"). One-token list
 * entries keep first-token semantics; built-in-deny ops are only liftable
 * by the exact two-token `annex <op>` allow entry (a bare `"annex"`
 * allow never reaches them). RW ops are opt-in per repo; unknown ops are
 * err-closed. Refusal reasons name the policy source (built-in default
 * table vs repo giwt.toml entry).
 */
export function classifyAnnex(subArgs: readonly string[], lists: GitPolicyLists): GitVerdict {
  const op = subArgs[0];
  if (op === undefined) {
    return { verdict: "block", reason: "git annex requires a subcommand", subcommand: "annex" };
  }
  const label = `annex ${op}`;
  if (subArgs.some((a) => a.includes("${"))) {
    return {
      verdict: "block",
      reason:
        `git ${label} argument contains '\${' — interpolation is refused (macro-free annex args)`,
      subcommand: label,
    };
  }
  const denyEntry = findAnnexEntry(lists.deny, op);
  if (denyEntry !== undefined) {
    return {
      verdict: "block",
      reason: `git ${denyEntry} is listed in [git] deny (repo giwt.toml policy)`,
      subcommand: label,
    };
  }
  if (ANNEX_DENY_SUBCOMMANDS[op] && !lists.allow.includes(label)) {
    return {
      verdict: "block",
      reason:
        `git ${label} is denied by the giwt built-in default policy (destructive — a backup stack must never destroy its last known copy; numcopies is the only remaining safety net). To accept the risk, add "${label}" under [git] allow in repo giwt.toml`,
      subcommand: label,
    };
  }
  if (
    findAnnexEntry(lists.safe, op) !== undefined || findAnnexEntry(lists.allow, op) !== undefined
  ) {
    return { verdict: "pass", subcommand: label };
  }
  if (ANNEX_RO_SUBCOMMANDS[op]) return { verdict: "pass", subcommand: label };
  if (ANNEX_ALLOW_SUBCOMMANDS[op]) {
    return {
      verdict: "block",
      reason:
        `git ${label} mutates annex state — reachable only via [git] allow = ["${label}"] in repo giwt.toml`,
      subcommand: label,
    };
  }
  return {
    verdict: "block",
    reason: `git ${label} is not in the giwt allowlist (unknown annex subcommand — err-closed)`,
    subcommand: label,
  };
}

/** Allow entries that lift the built-in destructive-annex deny (two-token
 *  `annex <op>` form only) — the passthrough handler warns once per entry. */
export function destructiveAnnexAllows(lists: GitPolicyLists): string[] {
  return lists.allow.filter((e) =>
    e.startsWith("annex ") && ANNEX_DENY_SUBCOMMANDS[e.slice("annex ".length)] === true
  );
}
