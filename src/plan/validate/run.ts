// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * The .plan/ validator dispatcher: expands the gate selection, optionally
 * scopes per-file gates to files changed vs a diff base, runs each gate
 * (with --fix handling), and aggregates the result.
 *
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

import { relative } from "node:path";
import { gitSync } from "../../utils/git";
import { type GateScope, runGate } from "./gates-run";
import {
  ALL_GATES,
  type ConcreteGate,
  FIXABLE_GATES,
  type GateName,
  type GateResult,
  type ValidateOptions,
  type ValidateResult,
} from "./types";

/**
 * Files under `planDirName` (repo-relative, forward slashes) changed vs
 * `diffBase`, plus untracked files — `git diff` alone hides a freshly
 * created not-yet-committed ticket, which would silently skip it from the
 * scoped gates. Throws (never silently degrades to a full scan) when git
 * fails: the caller already resolved the base ref, so a failure here is real.
 */
function changedPlanFiles(
  worktreeRoot: string,
  planDirName: string,
  diffBase: string,
): Set<string> {
  const tracked = gitSync(worktreeRoot, "diff", "--name-only", diffBase, "--", planDirName);
  const untracked = gitSync(
    worktreeRoot,
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    planDirName,
  );
  return new Set(`${tracked}\n${untracked}`.split("\n").filter((l) => l.length > 0));
}

export function runValidate(opts: ValidateOptions): ValidateResult {
  // "all" respects [plan] interconnect = false; --gates interconnect
  // explicitly still runs it.
  const all: GateName[] = opts.interconnectGate === false
    ? ALL_GATES.filter((g) => g !== "interconnect")
    : ALL_GATES;
  const gates = opts.gates.includes("all") ? all : opts.gates;
  const unknown = gates.filter((g) => !ALL_GATES.includes(g));
  if (unknown.length > 0) {
    throw new Error(
      `validate: unknown gate(s) ${unknown.join(", ")} — valid: all, ${ALL_GATES.join(", ")}`,
    );
  }
  const results: GateResult[] = [];
  // Diff-scoped per-file gates: only files changed vs opts.diffBase (plus
  // untracked) are inspected. null = no scoping (full scan).
  const planDirName = relative(opts.worktreeRoot, opts.planDir);
  const scoped = opts.diffBase === undefined
    ? null
    : changedPlanFiles(opts.worktreeRoot, planDirName, opts.diffBase);
  const scope: GateScope = scoped === null
    ? {}
    : {
      includeTicket: (f: string) => scoped.has(`${planDirName}/tickets/${f}`),
      includeEpic: (f: string) => scoped.has(`${planDirName}/epics/${f}`),
    };

  for (const gate of gates.filter((g): g is ConcreteGate => g !== "all")) {
    results.push(runGate(gate, opts, scope));
  }

  const issueCount = results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.level === "error").length,
    0,
  );
  const fixedCount = results.reduce(
    (sum, r) => sum + (r.fixes?.length ?? 0),
    0,
  );
  // A fixable gate that --fix left failing (the fix pass changed nothing)
  // is de-facto manual for these findings — report it alongside the
  // never-fixable gates so the summary names an actionable next step.
  const unfixable = opts.fix
    ? (results
      .filter((r) =>
        !r.pass
        && (!FIXABLE_GATES.includes(r.gate) || (r.fixes?.length ?? 0) === 0)
      )
      .map((r) => r.gate) as ConcreteGate[])
    : undefined;
  return {
    results,
    pass: issueCount === 0,
    issueCount,
    fixedCount,
    ...(unfixable && unfixable.length > 0 ? { unfixableGates: unfixable } : {}),
  };
}
