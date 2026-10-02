// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Comprehensive .plan/ validator — runs multiple checks in one pass.
 * Public surface; implementation lives in ./validate/*.
 *
 * Gates (selectable via --gates flag):
 *   format     — ticket + epic format compliance
 *   linkage    — epic↔ticket cross-link validation
 *   backlog    — backlog index sync (orphans/phantoms)
 *   tickets    — ticket index sync (delegates to runSync)
 *   code-map   — code map freshness
 *   links      — markdown internal link check
 *   spdx       — SPDX header compliance
 *   naming     — ticket filename convention incl. case-insensitive collision rejection
 *   epics-doc  — epics-index.md freshness
 *   status-vocab — ticket **Status:** value vocabulary (aliases via settings)
 *   matrix     — feature-matrix.md freshness (projected from index.json)
 *   all        — run every gate (default)
 *
 * Each gate returns a GateResult with pass/fail + findings.
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

export { TICKET_REQUIRED_SECTIONS } from "./validate/format-gates";
export {
  MAX_LISTED_FINDINGS,
  renderUnfixableGates,
  renderValidateSummary,
} from "./validate/render";
export { runValidate } from "./validate/run";
export {
  ALL_GATES,
  type Finding,
  FIXABLE_GATES,
  type GateName,
  type GateResult,
  resolveFromRoot,
  type ValidateOptions,
  type ValidateResult,
} from "./validate/types";
