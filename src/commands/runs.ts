// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Runs command — list recent run records (the analyzable view over
 * meta.json in each run dir under paths.runlog/runs).
 *
 * Usage: giwt runs [--last N] [--json]
 */

import { type WorktreeConfig } from "../utils/config";
import { colorize, log, raw } from "../utils/output";
import { formatOutcome, listRuns } from "../utils/runlog";

export async function runs(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  let last = 20;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--last") {
      const value = parseInt(args[++i] ?? "", 10);
      if (Number.isFinite(value) && value > 0) last = value;
    } else if (arg.startsWith("--last=")) {
      const value = parseInt(arg.slice("--last=".length), 10);
      if (Number.isFinite(value) && value > 0) last = value;
    } else if (arg === "--json") {
      json = true;
    } else {
      log("error", `unknown flag '${arg}'`);
      raw("  Usage: giwt runs [--last N] [--json]");
      process.exit(1);
    }
  }

  const records = listRuns(config, last);
  if (json) {
    raw(JSON.stringify(records, null, 2));
    return;
  }
  if (records.length === 0) {
    log("info", "No run records");
    return;
  }
  for (const record of records) {
    const startMs = Date.parse(record.start);
    const dur = record.end ? `${Date.parse(record.end) - startMs}ms` : "abnormal";
    const exitLabel = record.exitCode === 0
      ? colorize(String(record.exitCode), "green")
      : colorize(record.exitCode === undefined ? "?" : String(record.exitCode), "yellow");
    raw(
      `  ${record.start.slice(5, 16).replace("T", " ")} ${
        record.cmd.padEnd(14)
      } exit=${exitLabel} ${dur}`,
    );
    raw(`    ${record.dir}`);
    const outcome = formatOutcome(record.outcome);
    if (outcome.length > 0) raw(`    ${outcome}`);
  }
}
