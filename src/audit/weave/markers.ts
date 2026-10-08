// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orphaned-comment-marker scan — weave damage check 3 (FEAT-weave-damage-
 * scan).
 *
 * Resolution artifacts left inline by a merge: leftover conflict markers
 * (critical — the file is still mid-conflict), git `hint:` notes absorbed
 * into comments (the branches.ts case: an orphaned merge hint comment plus
 * the blank line it had absorbed), conflict-note prose and branch-name
 * hints. All info-severity except conflict markers: prose signals are
 * ranked for a human, never hard-failed — repos legitimately write about
 * conflicts and branches in comments.
 */

import type { AuditFinding, AuditSeverity } from "../types";

interface MarkerPattern {
  re: RegExp;
  label: string;
  severity: AuditSeverity;
  rank: number;
}

const MARKER_PATTERNS: readonly MarkerPattern[] = [
  { re: /^<{7}(?:\s|$)/, label: "conflict marker start", severity: "critical", rank: 92 },
  { re: /^={7}\s*$/, label: "conflict marker separator", severity: "critical", rank: 92 },
  { re: /^>{7}(?:\s|$)/, label: "conflict marker end", severity: "critical", rank: 92 },
  { re: /^\s*(?:\/\/|#|\*)?\s*hint:/i, label: "resolution hint", severity: "info", rank: 40 },
  {
    re: /^\s*(?:\/\/|#|\*).*\bconflict\b/i,
    label: "conflict note",
    severity: "info",
    rank: 35,
  },
  {
    re: /^\s*(?:\/\/|#|\*).*\bbranch(?:es)?\s*:/i,
    label: "branch-name hint",
    severity: "info",
    rank: 35,
  },
];

export function scanMarkers({ text, path }: { text: string; path: string; }): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const pattern of MARKER_PATTERNS) {
      if (!pattern.re.test(line)) continue;
      findings.push({
        detector: "weave",
        reason: "orphaned-comment-marker",
        severity: pattern.severity,
        rank: pattern.rank,
        message: `${pattern.label} left inline — a resolution artifact survived the merge`,
        paths: [path],
        evidence: [
          { kind: "line", path, start: i + 1, end: i + 1, content: line.trim().slice(0, 120) },
          { kind: "token", detail: pattern.label },
        ],
      });
      break;
    }
  }
  return findings;
}
