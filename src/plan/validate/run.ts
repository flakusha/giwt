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

import { join, relative } from "node:path";
import { gitSync } from "../../utils/git";
import {
  checkBacklog,
  checkCodeMap,
  checkEpicsDoc,
  checkLinks,
  checkNaming,
  checkSpdx,
  checkStatusVocab,
  checkTicketIndex,
} from "./content-gates";
import {
  fixBacklogGate,
  fixCodeMapGate,
  fixEpicsDocGate,
  fixStatusVocabGate,
  fixTicketIndexGate,
} from "./fixes";
import { checkEpicFormat, checkLinkage, checkTicketFormat } from "./format-gates";
import { runMatrixGate } from "./matrix-gate";
import {
  ALL_GATES,
  type ConcreteGate,
  FIXABLE_GATES,
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
  const gates = opts.gates.includes("all") ? ALL_GATES : opts.gates;
  const unknown = gates.filter((g) => !ALL_GATES.includes(g));
  if (unknown.length > 0) {
    throw new Error(
      `validate: unknown gate(s) ${unknown.join(", ")} — valid: all, ${ALL_GATES.join(", ")}`,
    );
  }
  const results: GateResult[] = [];
  const backlogPath = join(opts.planDir, "backlog", "open.md");
  // Diff-scoped per-file gates: only files changed vs opts.diffBase (plus
  // untracked) are inspected. null = no scoping (full scan).
  const planDirName = relative(opts.worktreeRoot, opts.planDir);
  const scoped = opts.diffBase === undefined
    ? null
    : changedPlanFiles(opts.worktreeRoot, planDirName, opts.diffBase);
  const includeTicket = scoped === null
    ? undefined
    : (f: string) => scoped.has(`${planDirName}/tickets/${f}`);
  const includeEpic = scoped === null
    ? undefined
    : (f: string) => scoped.has(`${planDirName}/epics/${f}`);

  for (const gate of gates) {
    switch (gate) {
      case "format": {
        const findings = [
          ...checkTicketFormat(opts.ticketsDir, includeTicket),
          ...checkEpicFormat(opts.epicsDir, includeEpic),
        ];
        results.push({
          gate,
          pass: findings.filter((f) => f.level === "error").length === 0,
          findings,
        });
        break;
      }
      case "linkage": {
        const findings = checkLinkage(opts.ticketsDir, opts.epicsDir, includeTicket, includeEpic);
        results.push({
          gate,
          pass: findings.filter((f) => f.level === "error").length === 0,
          findings,
        });
        break;
      }
      case "backlog": {
        const findings = checkBacklog(opts.backlogDir, opts.backlogIndexFiles);
        const hasErrors = findings.some((f) => f.level === "error");
        let pass = !hasErrors;
        let fixMsgs: string[] = [];
        if (opts.fix && hasErrors) {
          fixMsgs = fixBacklogGate(opts.backlogDir, opts.backlogIndexFiles);
          if (fixMsgs.length > 0) {
            // Re-check: applyFixes handles orphans/phantoms but "outside"
            // entries (warn level) remain — so error-level findings should
            // be gone after fix.
            const rechecked = checkBacklog(opts.backlogDir, opts.backlogIndexFiles);
            pass = !rechecked.some((f) => f.level === "error");
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "tickets": {
        const findings = checkTicketIndex(
          opts.worktreeRoot,
          opts.ticketsDir,
          opts.runSync,
          opts.diffBase,
        );
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          // Don't re-check — runSync is expensive (calls git issue CLI).
          // Trust the fix; user can re-run validate to confirm.
          fixMsgs = fixTicketIndexGate(
            opts.worktreeRoot,
            opts.ticketsDir,
            opts.runSync,
            opts.diffBase,
          );
          if (fixMsgs.length > 0) pass = true;
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "code-map": {
        const findings = checkCodeMap(opts.projectRoot, opts.codeMapPath, opts.mapSources);
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          fixMsgs = fixCodeMapGate(opts.projectRoot, opts.codeMapPath, opts.mapSources);
          if (fixMsgs.length > 0) {
            const rechecked = checkCodeMap(opts.projectRoot, opts.codeMapPath, opts.mapSources);
            pass = rechecked.length === 0;
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "links": {
        const findings = checkLinks(
          opts.projectRoot,
          opts.linkScanDirs,
          opts.ticketsDir,
          opts.srcDir,
        );
        results.push({
          gate,
          pass: findings.length === 0,
          findings,
        });
        break;
      }
      case "spdx": {
        const findings = checkSpdx(opts.planDir);
        results.push({
          gate,
          pass: findings.length === 0,
          findings,
        });
        break;
      }
      case "naming": {
        const findings = checkNaming(opts.ticketsDir);
        results.push({
          gate,
          pass: findings.length === 0,
          findings,
        });
        break;
      }
      case "epics-doc": {
        const findings = checkEpicsDoc(opts.epicsDir, opts.epicsIndexPath, backlogPath);
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          fixMsgs = fixEpicsDocGate(opts.epicsDir, opts.epicsIndexPath, backlogPath);
          if (fixMsgs.length > 0) {
            const rechecked = checkEpicsDoc(opts.epicsDir, opts.epicsIndexPath, backlogPath);
            pass = rechecked.length === 0;
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "matrix": {
        const { findings, pass, fixMsgs } = runMatrixGate(opts.planDir, opts.fix === true);
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
      case "status-vocab": {
        const statusAliases = opts.statusAliases ?? {};
        const findings = checkStatusVocab(opts.ticketsDir, statusAliases, includeTicket);
        let pass = findings.length === 0;
        let fixMsgs: string[] = [];
        if (opts.fix && !pass) {
          fixMsgs = fixStatusVocabGate(opts.ticketsDir, statusAliases);
          if (fixMsgs.length > 0) {
            // Rewriting is a cheap in-place file edit, so re-check like the
            // code-map gate: the post-fix findings are exactly the values
            // --fix could not resolve (green only when none remain).
            const rechecked = checkStatusVocab(opts.ticketsDir, statusAliases, includeTicket);
            findings.length = 0;
            findings.push(...rechecked);
            pass = rechecked.length === 0;
          }
        }
        results.push({
          gate,
          pass,
          findings,
          ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}),
        });
        break;
      }
    }
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
