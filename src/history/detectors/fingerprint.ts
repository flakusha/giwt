// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Rename-insensitive duplicate detection (BUG-patch-id-duplicate-detection).
 * For each range commit NOT already classified as a plain duplicate-patch-id,
 * run findAppliedDuplicates against the target. A rename between two copies
 * of the same change defeats patch-id dedup, so this catches what the
 * stable patch-id check misses.
 */

import { duplicateCommitFinding, findAppliedDuplicates } from "../../audit/fingerprint";
import type { AuditEvidenceSha, AuditEvidenceToken } from "../../audit/types";
import type { AuditFinding, Detector, FindingReason } from "../audit";

export const renameInsensitiveDuplicates: Detector = ({ root, onto, commits, targetPids }) => {
  if (targetPids === null) return [];
  const findings: AuditFinding[] = [];
  for (const commit of commits) {
    if (commit.parents.length > 1 || commit.patchId === null) continue;
    // Skip commits already flagged as plain duplicate-patch-id
    if (targetPids.has(commit.patchId)) continue;
    const matches = findAppliedDuplicates({
      repoRoot: root,
      candidate: commit.sha,
      target: onto,
    });
    for (const match of matches) {
      findings.push({
        reason: "duplicate-rename-insensitive" as FindingReason,
        sha: commit.sha,
        subject: commit.subject,
        patchId: commit.patchId,
        twins: [match.target],
        evidence: duplicateCommitFinding(match).evidence
          .filter((e): e is AuditEvidenceSha | AuditEvidenceToken =>
            e.kind === "sha" || e.kind === "token"
          )
          .map((e) => e.detail)
          .join("; "),
      });
    }
  }
  return findings;
};
