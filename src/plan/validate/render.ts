// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Bounded summary rendering for the .plan/ validator (pure; caller prints):
 * summary-first report with per-gate pass/fail, a findings cap, fix notes,
 * and manual next steps for gates --fix cannot repair.
 */

import type { ConcreteGate, GateResult, ValidateResult } from "./types";

/** Max findings listed per gate in the default human summary (--json lifts the cap). */
export const MAX_LISTED_FINDINGS = 20;

/** Manual remedy per gate — every reported problem names an actionable next step. */
const MANUAL_FIX_HINTS: Record<ConcreteGate, string> = {
  format: "add the missing **Section:** headers to the flagged ticket/epic files",
  linkage: "add the missing epic↔ticket links to the flagged files",
  backlog: "reconcile the backlog indexes (giwt backlog sync --fix)",
  tickets: "reconcile the ticket index (giwt sync)",
  "code-map": "regenerate .plan/code-map.json (giwt plan code-map)",
  links: "fix or remove the broken links/refs listed in the findings",
  spdx: "add an SPDX-License-Identifier header to the flagged .md files",
  naming: "rename the flagged files to the TYPE-kebab-case-title.md convention",
  "epics-doc": "regenerate .plan/epics-index.md (giwt plan gen-docs)",
  matrix: "regenerate .plan/feature-matrix.md (giwt plan matrix)",
  "status-vocab":
    "rename the flagged **Status:** values to the vocabulary, or add [status.aliases] entries in giwt.toml",
};

/** Per-gate error/warning counts for the summary line. */
function gateCounts(r: GateResult): string {
  const errors = r.findings.filter((f) => f.level === "error").length;
  const warns = r.findings.length - errors;
  const parts: string[] = [];
  if (errors > 0 || !r.pass) parts.push(`${errors} error(s)`);
  if (warns > 0) parts.push(`${warns} warning(s)`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** Explain which gates --fix left unfixed, each with a manual next step. */
export function renderUnfixableGates(gates: readonly ConcreteGate[]): string[] {
  return gates.map((g) => `--fix cannot auto-fix '${g}' — ${MANUAL_FIX_HINTS[g]}`);
}

/**
 * Render the summary-first, bounded validation report (no I/O):
 * per-gate pass/fail + counts, the first MAX_LISTED_FINDINGS findings per
 * gate, a "… and N more" pointer to --json, fix notes, and unfixable gates.
 */
export function renderValidateSummary(result: ValidateResult): string[] {
  const lines: string[] = [];
  for (const r of result.results) {
    const status = r.pass ? "✓" : "✗";
    const icon = r.pass ? "OK" : "FAIL";
    lines.push(`  ${status} ${r.gate.padEnd(12)} ${icon}${gateCounts(r)}`);
    for (const f of r.findings.slice(0, MAX_LISTED_FINDINGS)) {
      const prefix = f.level === "error" ? "  ✗" : "  ⚠";
      lines.push(`  ${prefix} ${f.message}`);
    }
    const hidden = r.findings.length - MAX_LISTED_FINDINGS;
    if (hidden > 0) {
      lines.push(`    … and ${hidden} more — full findings: giwt plan validate --json`);
    }
    for (const fx of r.fixes ?? []) {
      lines.push(`    ↳ fixed: ${fx}`);
    }
  }
  if (result.unfixableGates && result.unfixableGates.length > 0) {
    lines.push(...renderUnfixableGates(result.unfixableGates));
  }
  return lines;
}
