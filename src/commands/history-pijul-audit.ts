// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Pijul-mode `history audit`: same change hash in two channels is the only
 * intrinsic duplicate signal; git-only detectors are reported as inapplicable.
 */

import { auditPijulHistory } from "../history/pijul-audit";
import { type WorktreeConfig } from "../utils/config";
import { type OutFormat, renderRecords } from "../utils/emit";
import { raw } from "../utils/output";
import { defaultPijulSpawn } from "../vcs/pijul";

export function runPijulAudit({ branch, onto, config, format }: {
  branch: string;
  onto: string | undefined;
  config: WorktreeConfig;
  format: OutFormat;
}): void {
  const target = onto ?? config.settings.branches.root;
  const report = auditPijulHistory({
    root: config.repoRoot,
    branch,
    target,
    spawn: defaultPijulSpawn,
  });
  const inapplicable = report.inapplicable.map((reason) => `  - ${reason}`);
  if (format !== "human") {
    raw(renderRecords({ ...report, inapplicable }, format, {
      emoji: (rec) => {
        const r = rec as { findings: unknown[]; };
        return `${r.findings.length > 0 ? "⚠️" : "✅"} ${branch}: ${r.findings.length} finding(s)`;
      },
    }));
  } else {
    raw(
      `Pijul history audit: ${branch} vs ${target} (${report.findings.length} duplicate change hash(es))`,
    );
    for (const finding of report.findings) raw(`  ${finding.sha} ${finding.evidence}`);
    if (inapplicable.length > 0) {
      raw("Inapplicable under pijul:");
      for (const line of inapplicable) raw(line);
    }
  }
  process.exitCode = report.findings.length > 0 ? 1 : 0;
}
