// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt history` — pre-rebase history tooling.
 *
 *   audit [<branch>] [--onto <ref>]  shape + suspicious-commit inventory
 *   skips [--vs <ref>]              rebase skip ledger readback (+verify)
 *
 * Gate semantics: audit exits 1 when suspicious commits are found;
 * skips --vs exits 1 when any dropped commit's justification cannot be
 * verified. Both use process.exitCode (never process.exit) so piped
 * --json output is never truncated.
 */

import {
  type AuditFinding,
  auditHistory,
  type AuditReport,
  type FindingReason,
} from "../history/audit";
import {
  readSkips,
  type SkipRecord,
  skipsPath,
  type SkipVerdict,
  verifySkips,
} from "../history/skips";
import type { WorktreeConfig } from "../utils/config";
import { type OutFormat, parseOutFlags, renderRecords } from "../utils/emit";
import { gitSyncQuiet } from "../utils/git";
import { log, raw } from "../utils/output";

const REASON_LABELS: Record<FindingReason, string> = {
  "duplicate-patch-id": "patch-id already in target history",
  "empty-commit": "no diff against parent",
  "merge-in-range": "merge commit in a linear-only range",
};

const DETECTED_LABELS: Record<string, string> = {
  duplicate: "duplicate",
  empty: "empty",
  unexplained: "unexplained",
};

const USAGE_LINES = [
  "  Usage: giwt history audit [<branch>] [--onto <ref>] [--json|--toml|--emoji]",
  "         giwt history skips [--vs <ref>] [--json|--toml|--emoji]",
];

function usageError(message: string): never {
  log("error", message);
  for (const line of USAGE_LINES) raw(line);
  process.exit(1);
}

/** Human rendering of an audit report (shape first, then findings). */
function renderAuditHuman(report: AuditReport): string {
  const shape = report.shape;
  const shapeBits = [
    `${shape.commits} commit(s)`,
    `${shape.merges} merge(s)${shape.octopus > 0 ? ` (${shape.octopus} octopus)` : ""}`,
    `${shape.mergeBases.length} merge-base(s)${shape.crissCross ? " [CRISS-CROSS]" : ""}`,
  ];
  const lines = [
    `History audit: ${report.branch} vs ${report.onto} (${report.range})`,
    `Shape: ${shape.linear ? "linear" : "non-linear"} — ${shapeBits.join(", ")}`,
    `Linearity: ${shape.mode} → ${shape.effective} (verdict: ${shape.verdict})`,
  ];
  const groups = Object.entries(report.findings) as Array<[FindingReason, unknown[]]>;
  const shown = groups.reduce((sum, [, list]) => sum + list.length, 0);
  if (shown === 0 && report.findingsTotal === undefined) {
    lines.push("Suspicious commits: none");
    return lines.join("\n");
  }
  lines.push(`Suspicious commits: ${report.findingsTotal ?? shown}`);
  for (const [reason, list] of groups) {
    lines.push(`  ${reason} (${list.length}) — ${REASON_LABELS[reason]}`);
    for (const entry of list) {
      const finding = entry as AuditFinding;
      const twins = finding.twins !== undefined ? ` twin ${finding.twins[0]!.slice(0, 7)}` : "";
      lines.push(`    ${finding.sha.slice(0, 8)}  ${finding.subject}${twins}`);
      lines.push(`      evidence: ${finding.evidence}`);
    }
  }
  if (report.findingsTotal !== undefined) {
    lines.push(
      `  … ${report.findingsTotal - shown} more findings not shown (raise [audit] max_findings)`,
    );
  }
  return lines.join("\n");
}

async function runAudit(rest: string[], config: WorktreeConfig, format: OutFormat): Promise<void> {
  let branch: string | undefined;
  let onto: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--onto") {
      onto = rest[++i];
      if (onto === undefined || onto === "") usageError("--onto requires a ref");
    } else if (arg.startsWith("--onto=")) {
      onto = arg.slice("--onto=".length);
    } else if (arg.startsWith("--")) {
      usageError(`unknown flag '${arg}'`);
    } else if (branch === undefined) {
      branch = arg;
    } else {
      usageError(`unexpected argument '${arg}'`);
    }
  }
  if (branch === undefined) {
    branch = gitSyncQuiet(config.worktreeRoot, "branch", "--show-current").trim();
    if (branch === "") usageError("no branch given and HEAD is detached");
  }
  const target = onto ?? config.settings.branches.root;
  const report = auditHistory({
    root: config.repoRoot,
    branch,
    onto: target,
    ...config.settings.audit,
  });
  if (format !== "human") {
    raw(renderRecords(report, format, {
      emoji: (rec) => {
        const r = rec as AuditReport;
        const count = r.findingsTotal
          ?? Object.values(r.findings).reduce((sum, list) => sum + list.length, 0);
        return `${count > 0 ? "⚠️" : "✅"} ${r.range}: ${count} finding(s)`;
      },
    }));
  } else {
    raw(renderAuditHuman(report));
    if (report.exit !== 0) {
      log("warn", `suspicious commits found — triage before rebasing ${branch} onto ${target}`);
    }
  }
  process.exitCode = report.exit;
}

function skipLine(record: SkipRecord): string {
  const detected = DETECTED_LABELS[record.reason.detected] ?? record.reason.detected;
  const note = record.reason.note !== undefined ? ` :: ${record.reason.note}` : "";
  return `${record.ts.slice(0, 16)} ${record.branch} ${record.sha.slice(0, 8)} ${detected}  `
    + `${record.subject} (onto ${record.onto})${note}`;
}

/** Flat machine record for one comparison verdict. */
function verdictRecord(verdict: SkipVerdict): Record<string, unknown> {
  return {
    ...verdict.record,
    justified: verdict.justified,
    ...("twin" in verdict ? { twin: verdict.twin } : {}),
    ...("problem" in verdict ? { problem: verdict.problem } : {}),
  };
}

async function runSkips(rest: string[], config: WorktreeConfig, format: OutFormat): Promise<void> {
  let vs: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--vs") {
      vs = rest[++i];
      if (vs === undefined || vs === "") usageError("--vs requires a ref");
    } else if (arg.startsWith("--vs=")) {
      vs = arg.slice("--vs=".length);
    } else {
      usageError(`unknown flag '${arg}'`);
    }
  }
  const records = readSkips(config);
  if (vs === undefined) {
    if (format !== "human") {
      raw(renderRecords(records, format, { emoji: (rec) => skipLine(rec as SkipRecord) }));
    } else {
      log("info", `Rebase skip ledger: ${records.length} record(s) — ${skipsPath(config)}`);
      for (const record of records) raw(`  ${skipLine(record)}`);
    }
    return;
  }
  // Comparison mode: a skip is justified only if its twin is verifiable
  // in the compared ref; unverifiable drops are probable real-work loss.
  const verdicts = verifySkips({ root: config.repoRoot, records, vs });
  const flagged = verdicts.filter((v) => !v.justified);
  if (format !== "human") {
    raw(renderRecords(verdicts.map(verdictRecord), format, {
      emoji: (rec) => {
        const v = rec as { justified: boolean; sha: string; reason: { detected: string; }; };
        return `${v.justified ? "✅" : "🚨"} ${v.sha.slice(0, 8)} ${v.reason.detected}`;
      },
    }));
  } else {
    log("info", `Verifying ${records.length} skip(s) against '${vs}':`);
    for (const verdict of verdicts) {
      if (verdict.justified) {
        const twin = "twin" in verdict
          ? ` twin ${verdict.twin!.slice(0, 7)} verified`
          : " (empty diff verified)";
        raw(`  ✅ ${skipLine(verdict.record)}${twin}`);
      } else {
        raw(`  🚨 ${skipLine(verdict.record)}`);
        raw(`     ${verdict.problem}`);
      }
    }
    if (flagged.length > 0) {
      log(
        "error",
        `${flagged.length} of ${records.length} skip(s) unjustified — probable real-work loss`,
      );
    } else {
      log("success", `all ${records.length} skip(s) justified against '${vs}'`);
    }
  }
  process.exitCode = flagged.length > 0 ? 1 : 0;
}

export async function history(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const subcommand = rest[0];
  if (subcommand === "audit" || subcommand === "skips") {
    rest.shift();
    return subcommand === "audit"
      ? runAudit(rest, config, format)
      : runSkips(rest, config, format);
  }
  if (subcommand !== undefined) usageError(`unknown subcommand '${subcommand}'`);
  usageError("a subcommand is required");
}
