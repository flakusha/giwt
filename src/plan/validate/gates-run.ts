// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Per-gate dispatch for the .plan/ validator: one case per gate name,
 * each returning a GateResult. Split out of run.ts so the dispatcher
 * (gate expansion, diff scoping, aggregation) stays small; both gates
 * with a --fix path and read-only gates live here side by side.
 *
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

import { join } from "node:path";
import { runInterconnectGate } from "../interconnect/gate";
import type { InterconnectOptions } from "../interconnect/types";
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
import {
  checkEpicFormat,
  checkLinkage,
  checkTicketCaveats,
  checkTicketFormat,
} from "./format-gates";
import { runMatrixGate } from "./matrix-gate";
import { checkOrphans } from "./orphan-gate";
import { type ConcreteGate, type GateResult, type ValidateOptions } from "./types";

/** Files a per-file gate may inspect, resolved by the dispatcher. */
export interface GateScope {
  includeTicket?: (f: string) => boolean;
  includeEpic?: (f: string) => boolean;
}

/** Run one concrete gate; "all" is expanded by the caller, never passed. */
export function runGate(
  gate: ConcreteGate,
  opts: ValidateOptions,
  scope: GateScope,
): GateResult {
  switch (gate) {
    case "format": {
      const findings = [
        ...checkTicketFormat(opts.ticketsDir, scope.includeTicket),
        // Required **Caveats:** on diff-scoped FEAT/TASK/BUG tickets —
        // same scope as checkTicketFormat (undefined = full scan, vacuous).
        ...checkTicketCaveats(opts.ticketsDir, scope.includeTicket),
        ...checkEpicFormat(opts.epicsDir, scope.includeEpic),
      ];
      return { gate, pass: findings.filter((f) => f.level === "error").length === 0, findings };
    }
    case "linkage": {
      const findings = checkLinkage(
        opts.ticketsDir,
        opts.epicsDir,
        scope.includeTicket,
        scope.includeEpic,
      );
      return { gate, pass: findings.filter((f) => f.level === "error").length === 0, findings };
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
      return { gate, pass, findings, ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}) };
    }
    case "tickets": {
      const syncFindings = checkTicketIndex(
        opts.worktreeRoot,
        opts.ticketsDir,
        opts.runSync,
        opts.diffBase,
      );
      // Advisory orphan-tag/orphan-binding findings ride the tickets gate
      // at warn level: reported, never counted against pass (see the
      // advisory-first policy note in orphan-gate.ts).
      const advisory = checkOrphans({ ticketsDir: opts.ticketsDir, epicsDir: opts.epicsDir });
      const findings = [...syncFindings, ...advisory];
      let pass = syncFindings.length === 0;
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
      return { gate, pass, findings, ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}) };
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
      return { gate, pass, findings, ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}) };
    }
    case "links": {
      const findings = checkLinks(
        opts.projectRoot,
        opts.linkScanDirs,
        opts.ticketsDir,
        opts.srcDir,
      );
      return { gate, pass: findings.length === 0, findings };
    }
    case "spdx": {
      const findings = checkSpdx(opts.planDir);
      return { gate, pass: findings.length === 0, findings };
    }
    case "naming": {
      const findings = checkNaming(opts.ticketsDir);
      return { gate, pass: findings.length === 0, findings };
    }
    case "epics-doc": {
      const backlogPath = join(opts.planDir, "backlog", "open.md");
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
      return { gate, pass, findings, ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}) };
    }
    case "matrix": {
      const { findings, pass, fixMsgs } = runMatrixGate(opts.planDir, opts.fix === true);
      return { gate, pass, findings, ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}) };
    }
    case "status-vocab": {
      const statusAliases = opts.statusAliases ?? {};
      const findings = checkStatusVocab(opts.ticketsDir, statusAliases, scope.includeTicket);
      let pass = findings.length === 0;
      let fixMsgs: string[] = [];
      if (opts.fix && !pass) {
        fixMsgs = fixStatusVocabGate(opts.ticketsDir, statusAliases);
        if (fixMsgs.length > 0) {
          // Rewriting is a cheap in-place file edit, so re-check like the
          // code-map gate: the post-fix findings are exactly the values
          // --fix could not resolve (green only when none remain).
          const rechecked = checkStatusVocab(opts.ticketsDir, statusAliases, scope.includeTicket);
          findings.length = 0;
          findings.push(...rechecked);
          pass = rechecked.length === 0;
        }
      }
      return { gate, pass, findings, ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}) };
    }
    case "interconnect": {
      const interconnectOpts: InterconnectOptions = {
        projectRoot: opts.projectRoot,
        ticketsDir: opts.ticketsDir,
        epicsDir: opts.epicsDir,
        codeMapPath: opts.codeMapPath,
        indexPath: join(opts.planDir, "tickets", "index.json"),
      };
      const { findings, pass, fixMsgs } = runInterconnectGate({
        ...interconnectOpts,
        planDir: opts.planDir,
        fix: opts.fix === true,
      });
      return { gate, pass, findings, ...(fixMsgs.length > 0 ? { fixes: fixMsgs } : {}) };
    }
  }
}
