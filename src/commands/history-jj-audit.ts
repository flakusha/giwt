// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** `giwt history audit` under a colocated jj backend: git-plumbing shape and
 * patch-id findings, annotated with stable jj change IDs. */

import { auditJjHistory, type JjAuditFinding, type JjAuditReport } from "../history/jj-audit";
import { defaultJjHistorySpawn } from "../history/jj-history";
import type { WorktreeConfig } from "../utils/config";
import { type OutFormat, renderRecords } from "../utils/emit";
import { raw } from "../utils/output";

const LABELS: Record<string, string> = {
  "duplicate-patch-id": "patch-id already in target history",
  "duplicate-rename-insensitive": "rename-insensitive fingerprint match in target",
  "empty-commit": "no diff against parent",
  "merge-in-range": "merge commit in a linear-only range",
  "duplicate-change-id": "jj change ID already present in target history",
};

function countFindings(report: JjAuditReport): number {
  return Object.values(report.findings).reduce((sum, list) => sum + (list?.length ?? 0), 0);
}

export function runJjAudit({ branch, onto, config, format }: {
  branch: string;
  onto: string | undefined;
  config: WorktreeConfig;
  format: OutFormat;
}): void {
  const target = onto ?? config.settings.branches.root;
  const report = auditJjHistory({
    root: config.repoRoot,
    branch,
    onto: target,
    spawn: defaultJjHistorySpawn,
    ...config.settings.audit,
  });
  const count = countFindings(report);
  if (format !== "human") {
    raw(renderRecords(report, format, {
      emoji: (rec) => {
        const n = countFindings(rec as JjAuditReport);
        return `${n > 0 ? "⚠️" : "✅"} ${(rec as JjAuditReport).range}: ${n} finding(s)`;
      },
    }));
  } else {
    const shape = report.shape;
    const lines = [
      `Jj history audit (colocated): ${report.branch} vs ${report.onto} (${report.range})`,
      `Shape: ${
        shape.linear ? "linear" : "non-linear"
      } - ${shape.commits} commit(s), ${shape.merges} merge(s), ${shape.mergeBases.length} merge-base(s)`,
      `Linearity: ${shape.mode} to ${shape.effective} (verdict: ${shape.verdict})`,
      `Suspicious commits: ${count}`,
    ];
    for (const [reason, list] of Object.entries(report.findings)) {
      if (list === undefined) continue;
      lines.push(`  ${reason} (${list.length}) - ${LABELS[reason] ?? reason}`);
      for (const finding of list as JjAuditFinding[]) {
        const change = finding.changeId !== undefined ? `  [change ${finding.changeId}]` : "";
        lines.push(`    ${finding.sha.slice(0, 8)}  ${finding.subject}${change}`);
        lines.push(`      evidence: ${finding.evidence}`);
      }
    }
    if (report.findingsTotal !== undefined) {
      lines.push(
        `  ... ${
          report.findingsTotal - count
        } more findings not shown (raise [audit] max_findings)`,
      );
    }
    raw(lines.join("\n"));
  }
  process.exitCode = report.exit;
}
