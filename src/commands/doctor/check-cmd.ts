// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt doctor check` — run repo-health checks and report findings.
 *
 * Shares its check inventory with omp `/find-work` tool sources; `--json`
 * prints the machine-readable DoctorCheckReport (the cross-tool contract)
 * and nothing else on stdout. Uses process.exitCode (not process.exit) so
 * piped JSON is never truncated.
 */

import { freemem } from "node:os";
import {
  CHECK_IDS,
  checkExitCode,
  DOCTOR_PER_WORKER_MEM_MB,
  runDoctorChecks,
} from "../../doctor/check.ts";
import type { CheckId } from "../../doctor/check.ts";
import type { WorktreeConfig } from "../../utils/config.ts";
import { parseOutFlags, renderRecords } from "../../utils/emit.ts";
import { log, raw, section } from "../../utils/output.ts";
import { activeRun } from "../../utils/runlog.ts";

/** ✅/❌/⚠️ per check ok/fail/warn + check id — one line per check. */
function doctorCheckEmoji(record: Record<string, unknown> | unknown): string {
  const rec = record as {
    id: string;
    ok: boolean;
    skipped?: string;
    findings: Array<{ severity: string; }>;
    findingsTotal?: number;
  };
  if (rec.skipped !== undefined) return `⏭️ ${rec.id} skipped`;
  const hasError = !rec.ok || rec.findings.some((f) => f.severity === "error");
  const mark = hasError ? "❌" : rec.findings.length > 0 ? "⚠️" : "✅";
  const hidden = rec.findingsTotal === undefined
    ? 0
    : rec.findingsTotal - rec.findings.length;
  const suffix = hidden > 0 ? `, +${hidden} more not shown` : "";
  return `${mark} ${rec.id} (${rec.findings.length} finding(s)${suffix})`;
}

export async function runDoctorCheck(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  let root = config.worktreeRoot;
  let checks: CheckId[] | undefined;
  let jobs: number | undefined;
  let timeoutMs: number | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--root" || a.startsWith("--root=")) {
      const v = a.startsWith("--root=") ? a.slice(7) : rest[++i];
      if (v) root = v;
    } else if (a === "--checks" || a.startsWith("--checks=")) {
      const v = a.startsWith("--checks=") ? a.slice(9) : rest[++i];
      if (v) checks = v.split(",").map((s) => s.trim()).filter(Boolean) as CheckId[];
    } else if (a === "--jobs" || a.startsWith("--jobs=")) {
      const v = a.startsWith("--jobs=") ? a.slice(7) : rest[++i];
      if (v) jobs = Number(v);
    } else if (a === "--timeout" || a.startsWith("--timeout=")) {
      const v = a.startsWith("--timeout=") ? a.slice(10) : rest[++i];
      if (v) timeoutMs = Number(v);
    } else {
      log("error", `unknown flag '${a}'`);
      raw(
        "  Usage: giwt doctor check [--json|--toml|--emoji] [--checks <csv>] [--jobs <n>] [--timeout <ms>] [--root <dir>]",
      );
      process.exit(1);
    }
  }
  if (checks) {
    const unknown = checks.filter((c) => !(CHECK_IDS as readonly string[]).includes(c));
    if (unknown.length > 0) {
      log("error", `unknown check id(s): ${unknown.join(", ")}`);
      raw(`  known: ${CHECK_IDS.join(", ")}`);
      process.exit(1);
    }
  }
  if (jobs !== undefined && (!Number.isInteger(jobs) || jobs < 1)) {
    log("error", `--jobs must be an integer >= 1 (got ${jobs})`);
    process.exit(1);
  }
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
    log("error", `--timeout must be an integer >= 1 (got ${timeoutMs})`);
    process.exit(1);
  }
  // Per-check timings land in the run record, so `giwt runs --json` shows which
  // gate was slow and what it cost.
  const rec = activeRun();
  // Budget override beats the OS free-memory auto default; the cap itself is
  // applied inside runDoctorChecks at dispatch time.
  const budgetMb = config.settings.doctor.memoryBudgetMb;
  const availableMemMb = budgetMb > 0 ? budgetMb : Math.floor(freemem() / 2 ** 20);
  const report = await runDoctorChecks(
    root,
    {
      ...(checks ? { checks } : {}),
      jobs: jobs ?? config.settings.doctor.jobs,
      timeoutMs: timeoutMs ?? config.settings.doctor.timeoutMs,
      availableMemMb,
      ...(rec ? { recorder: rec } : {}),
      scratch: {
        config: config.settings.scratch,
        thresholds: {
          warnMb: config.settings.doctor.scratchpadWarnMb,
          errorMb: config.settings.doctor.scratchpadErrorMb,
          orphanWarn: config.settings.doctor.scratchpadOrphanWarn,
          oldestWarnDays: config.settings.doctor.scratchpadOldestWarnDays,
        },
        rootDir: config.settings.scratch.root,
      },
    },
    config.settings.commands.test,
  );
  // Low-memory clamp is reported, not silently swallowed. Every number comes
  // from the report — the applied sizing, not a local recomputation.
  if (report.jobs?.clamped) {
    log(
      "warn",
      `memory cap: doctor pool clamped ${report.jobs.requested} -> ${report.jobs.effective}`
        + ` (${report.jobs.availableMemMb} MB available, ${DOCTOR_PER_WORKER_MEM_MB} MB/worker)`,
    );
  }
  // Outcome summary on the run record: the same numbers the human report
  // and checkExitCode are built from, for `giwt runs` without opening files.
  const failedIds = report.checks
    .filter((c) =>
      (!c.ok && c.skipped === undefined) || c.findings.some((f) => f.severity === "error")
    )
    .map((c) => c.id);
  const skippedCount = report.checks.filter((c) => c.skipped !== undefined).length;
  const findingCount = report.checks.reduce(
    (n, c) => n + (c.findingsTotal ?? c.findings.length),
    0,
  );
  const passedCount = report.checks.length - skippedCount - failedIds.length;
  activeRun()?.outcome({
    doctor: `${passedCount}/${report.checks.length} ok, ${failedIds.length} failed, `
      + `${skippedCount} skipped, ${findingCount} findings`,
    ...(failedIds.length > 0 ? { failedGates: failedIds } : {}),
  });
  if (format !== "human") {
    // json/toml carry the whole report contract; emoji maps one line per
    // check, so it renders the checks array instead.
    raw(
      format === "emoji"
        ? renderRecords(report.checks, format, { emoji: doctorCheckEmoji })
        : renderRecords(report, format, { emoji: doctorCheckEmoji }),
    );
    process.exitCode = checkExitCode(report);
    return;
  }
  section("doctor: check");
  if (report.checks.length === 0) {
    log("info", "No applicable checks for this project");
    return;
  }
  for (const check of report.checks) {
    if (check.skipped) {
      raw(`   [=] ${check.id} — skipped (${check.skipped})`);
      continue;
    }
    if (!check.ok) {
      raw(`   [FAIL] ${check.id} (${check.tool}) — ${check.error ?? "failed"}`);
      continue;
    }
    const tag = check.findings.some((f) => f.severity === "error")
      ? "FAIL"
      : check.findings.length > 0
      ? "warn"
      : "ok";
    raw(`   [${tag}] ${check.id} (${check.tool}) — ${check.findings.length} finding(s)`);
    for (const f of check.findings) {
      raw(`       ${f.file}:${f.line} [${f.rule}] ${f.message}`);
    }
    // BUG-doctor-check-caps: the cap used to truncate silently — the reader
    // could not tell a complete report from a capped one.
    if (check.findingsTotal !== undefined) {
      raw(`       … ${check.findingsTotal - check.findings.length} more not shown`);
    }
    for (const note of check.notes ?? []) {
      raw(`       ${note}`);
    }
  }
  process.exitCode = checkExitCode(report);
}
