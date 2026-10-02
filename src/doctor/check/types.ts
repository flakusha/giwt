// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Report contract types for doctor health checks.
 */

export type CheckId =
  | "lint"
  | "typecheck"
  | "tests"
  | "knip"
  | "jscpd"
  | "todo"
  | "leaks"
  | "scratchpad";

export const CHECK_IDS: readonly CheckId[] = [
  "lint",
  "typecheck",
  "tests",
  "knip",
  "jscpd",
  "todo",
  "leaks",
  "scratchpad",
];

export type CheckSeverity = "error" | "warning";

export interface CheckFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
  severity: CheckSeverity;
  kind: "bug" | "task";
}

export interface CheckResult {
  id: CheckId;
  /** Concrete tool invoked (e.g. "oxlint", "tsc --noEmit", "bun run test"). */
  tool: string;
  ok: boolean;
  /** Present when the check was skipped (not applicable, with reason). */
  skipped?: string;
  /** Present when the check failed to run (stderr tail, capped). */
  error?: string;
  findings: CheckFinding[];
  /** Human-readable summary lines (e.g. scratchpad sizes/ages); the doctor
   *  renderer prints them after the findings. Additive to the v1 report
   *  contract — consumers that ignore it stay compatible. */
  notes?: string[];
}

export interface DoctorCheckReport {
  version: 1;
  root: string;
  checks: CheckResult[];
  /** Pool sizing actually applied. Present only when the caller supplied
   *  `availableMemMb` (memory-capped run); additive, so consumers that
   *  ignore unknown fields stay compatible. */
  jobs?: {
    requested: number;
    effective: number;
    availableMemMb: number;
    clamped: boolean;
  };
}

/** Max findings kept per check (bounds JSON + human output). */
export const CHECK_MAX_FINDINGS = 20;
