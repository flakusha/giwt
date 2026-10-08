// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared structured-findings contract for every src/audit detector.
 *
 * A later workstream wires these into a `giwt history audit` umbrella
 * command and standalone gates, so findings must be self-describing:
 * the reason kind, the paths involved, machine-readable evidence, and a
 * severity/rank pair the reporter can sort and filter on. Detectors are
 * pure libraries — they never log, never exit, never mutate; reporting
 * and accept/reject decisions belong to the caller.
 */

/** Detector family that produced a finding. */
export type AuditDetector = "fingerprint" | "resurrected" | "weave";

/** Why the finding exists — one constant per distinct failure mode. */
export type AuditReason =
  | "duplicate-commit"
  | "number-collision"
  | "content-twin"
  | "repeated-lines"
  | "orphaned-trailing-block"
  | "orphaned-binding"
  | "orphaned-comment-marker"
  | "brace-anomaly";

/**
 * critical: silent blast-radius damage (resurrected migration, replayed
 * duplicate). warning: probable damage, needs eyes. info: weak signal,
 * ranked below the others.
 */
export type AuditSeverity = "critical" | "warning" | "info";

/** A line range with its (trimmed) content, echoed verbatim by the reporter. */
export interface AuditEvidenceLine {
  kind: "line";
  path: string;
  start: number;
  end: number;
  content: string;
}

/** A commit or blob sha, or a sha pair (`cand=target`) for tolerant matches. */
export interface AuditEvidenceSha {
  kind: "sha";
  detail: string;
}

/** A token pair or named value (`040_x → 045_x`, `leading number 40`). */
export interface AuditEvidenceToken {
  kind: "token";
  detail: string;
}

/** A count with context (`21 occurrences at lines 3, 9, …`). */
export interface AuditEvidenceCount {
  kind: "count";
  detail: string;
}

export type AuditEvidence =
  | AuditEvidenceLine
  | AuditEvidenceSha
  | AuditEvidenceToken
  | AuditEvidenceCount;

export interface AuditFinding {
  detector: AuditDetector;
  reason: AuditReason;
  severity: AuditSeverity;
  /**
   * 0–100 signal strength. Higher = more likely real damage; the reporter
   * sorts descending so a human triages in seconds. Ranks from different
   * detectors are comparable by design (severity anchors them).
   */
  rank: number;
  /** Human sentence; paths live in `paths`, shas/lines in `evidence`. */
  message: string;
  /** Paths involved (repo-relative where a repo root is known). */
  paths: string[];
  evidence: AuditEvidence[];
}
