// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared types, gate vocabulary, and option contracts for the .plan/
 * validator.
 */

import { isAbsolute, join } from "node:path";

export type GateName =
  | "format"
  | "linkage"
  | "backlog"
  | "tickets"
  | "code-map"
  | "links"
  | "spdx"
  | "naming"
  | "epics-doc"
  | "matrix"
  | "status-vocab"
  | "all";

export const ALL_GATES: GateName[] = [
  "format",
  "linkage",
  "backlog",
  "tickets",
  "code-map",
  "links",
  "spdx",
  "naming",
  "epics-doc",
  "status-vocab",
  "matrix",
];

/** Gates that can be auto-fixed when --fix is passed. */
export const FIXABLE_GATES: GateName[] = [
  "backlog",
  "tickets",
  "code-map",
  "epics-doc",
  "status-vocab",
  "matrix",
];

/** A gate that actually runs ("all" is expanded by runValidate, never a result). */
export type ConcreteGate = Exclude<GateName, "all">;

/**
 * Resolve a configured path against a root, respecting absolute inputs.
 * `join(root, p)` concatenates an absolute `p` onto `root` — the historic
 * worktree doubling bug (ticket FIX-plan-validate-path-doubling) — so the
 * isAbsolute check must come before the join.
 */
export function resolveFromRoot(root: string, configured: string): string {
  return isAbsolute(configured) ? configured : join(root, configured);
}

export interface Finding {
  gate: GateName;
  level: "error" | "warn";
  message: string;
}

export interface GateResult {
  gate: GateName;
  pass: boolean;
  findings: Finding[];
  fixes?: string[];
}

export interface ValidateResult {
  results: GateResult[];
  pass: boolean;
  issueCount: number;
  fixedCount: number;
  /** Gates --fix could not repair (no auto-fix exists). Set only when opts.fix. */
  unfixableGates?: ConcreteGate[];
}

// Imported lazily to avoid circular deps; validate caller provides the
// runSync function. This keeps validate pure of CLI-side imports.
export type TicketSyncFn = (
  root: string,
  opts: { fix: boolean; verbose: boolean; ticketsPath: string; },
) => number;

export interface ValidateOptions {
  projectRoot: string;
  worktreeRoot: string;
  ticketsDir: string;
  epicsDir: string;
  backlogDir: string;
  planDir: string;
  srcDir: string;
  codeMapPath: string;
  epicsIndexPath: string;
  mapSources: Array<{ dir: string; kind: string; }>;
  linkScanDirs: string[];
  backlogIndexFiles: string[];
  gates: GateName[];
  runSync: TicketSyncFn;
  /** Extra freeform → canonical Status aliases ([status.aliases] in giwt.toml). */
  statusAliases?: Record<string, string>;
  /**
   * Diff-base ref: when set, the purely per-file gates (format, linkage,
   * status-vocab) only inspect ticket/epic files changed relative to this
   * ref — foreign tickets from concurrently-active sessions in the same
   * repo no longer fail another branch's finalize. Cross-file and freshness
   * gates (naming, links, backlog, tickets, code-map, matrix, epics-doc,
   * spdx) stay global. Unset = full scan (historic behavior).
   */
  diffBase?: string;
  fix?: boolean;
}
