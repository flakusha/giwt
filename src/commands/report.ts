// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Report command — aggregate check-report status across worktrees
 */

import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { type WorktreeConfig } from "../utils/config";
import { colorize, log, raw, section } from "../utils/output";

interface CheckReport {
  branch: string;
  gitHead: string;
  runId: string;
  mode: string;
  gates: Record<string, { status: string; }>;
  passed: boolean;
  timestamp: string;
}

function formatStatus(status: string): string {
  switch (status) {
    case "passed":
      return colorize("✓ passed", "green");
    case "failed":
      return colorize("✗ failed", "red");
    case "skipped":
      return colorize("~ skipped", "yellow");
    default:
      return colorize(`? ${status}`, "gray");
  }
}

/**
 * Parse and validate raw check-report JSON.
 * Throws a descriptive Error when the payload is not parseable
 * or is missing the sections the renderer needs.
 */
function parseReport(rawText: string): CheckReport {
  const parsed: unknown = JSON.parse(rawText);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("report root is not a JSON object");
  }
  if (!("gates" in parsed)) {
    throw new Error("missing or invalid 'gates' section");
  }
  const gates: unknown = parsed.gates;
  if (typeof gates !== "object" || gates === null || Array.isArray(gates)) {
    throw new Error("missing or invalid 'gates' section");
  }
  // Narrowed: root object with object-typed `gates`; scalars are display-only.
  const checkReport: CheckReport = parsed as CheckReport;
  return checkReport;
}

function printReportRow(name: string, reportData: CheckReport): void {
  const overall = reportData.passed ? colorize("PASSED", "green") : colorize("FAILED", "red");
  raw(`  ${colorize(name, "cyan")} ${overall} — ${reportData.branch} @ ${reportData.gitHead}`);
  raw(`    run: ${reportData.runId} | mode: ${reportData.mode} | ${reportData.timestamp}`);
  for (const [gate, result] of Object.entries(reportData.gates)) {
    raw(`    ${gate}: ${formatStatus(result.status)}`);
  }
  raw("");
}

function printMalformedRow(name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  raw(`  ${colorize(name, "cyan")} ${colorize("malformed report", "red")} — ${message}`);
}

/**
 * List check-report status for the main repo and every worktree.
 * A missing report prints a "no report" row; an unreadable or
 * malformed report prints a "malformed report" row — one bad
 * report never aborts the listing.
 *
 * @param _args Unused CLI args.
 * @param config Worktree configuration with repo root and tree dir.
 * @returns Resolves when the listing is printed.
 */
export async function report(
  _args: string[],
  config: WorktreeConfig,
): Promise<void> {
  section("Check reports across worktrees");

  // Check main repo
  const mainReportPath = resolve(config.repoRoot, config.settings.paths.checkReport);
  if (existsSync(mainReportPath)) {
    try {
      const rawText = await readFile(mainReportPath, "utf-8");
      printReportRow("(main)", parseReport(rawText));
    } catch (error) {
      printMalformedRow("(main)", error);
    }
  } else {
    raw(`  ${colorize("(main)", "cyan")} ${colorize("no report", "gray")}`);
    raw("");
  }

  // Check worktrees
  if (!existsSync(config.treeDir)) {
    log("info", "No tree/ directory found");
    return;
  }

  const entries = await readdir(config.treeDir, { withFileTypes: true });
  const worktrees = entries.filter(e => e.isDirectory());

  for (const wt of worktrees) {
    const reportPath = resolve(config.treeDir, wt.name, config.settings.paths.checkReport);
    if (!existsSync(reportPath)) {
      raw(`  ${colorize(wt.name, "cyan")} ${colorize("no report", "gray")}`);
      continue;
    }

    try {
      const rawText = await readFile(reportPath, "utf-8");
      printReportRow(wt.name, parseReport(rawText));
    } catch (error) {
      printMalformedRow(wt.name, error);
      continue;
    }
  }
}
