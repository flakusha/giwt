// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Runs command — list recent run records (the analyzable view over
 * meta.json in each run dir under paths.runlog/runs).
 *
 * Usage: giwt runs [--last N] [--json|--toml|--emoji]
 */

import { type WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { colorize, log, raw } from "../utils/output";
import { formatOutcome, listRuns, readRunEvents } from "../utils/runlog";

/** TOML cannot represent null: drop null-valued fields from the record
 *  (said: null et al). JSON parse-back keeps every non-null field. */
function stripNulls<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

export async function runs(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  let last = 20;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) break;
    if (arg === "--last") {
      const value = parseInt(rest[++i] ?? "", 10);
      if (Number.isFinite(value) && value > 0) last = value;
    } else if (arg.startsWith("--last=")) {
      const value = parseInt(arg.slice("--last=".length), 10);
      if (Number.isFinite(value) && value > 0) last = value;
    } else {
      log("error", `unknown flag '${arg}'`);
      raw("  Usage: giwt runs [--last N] [--json|--toml|--emoji]");
      process.exit(1);
    }
  }

  const records = listRuns(config, last).map((record) => ({
    ...record,
    // Per-step durations live in each run's events.jsonl, not in meta.json,
    // so the machine projection reads them here rather than carrying a
    // duplicated summary inside the meta record.
    events: readRunEvents(record.dir),
  }));
  if (format !== "human") {
    raw(renderRecords(records.map(stripNulls), format, {
      emoji: (record) => {
        const rec = record as { cmd: string; start: string; end?: string; exitCode?: number; };
        const mark = rec.exitCode === 0 ? "✅" : "❌";
        const dur = rec.end ? ` ${Date.parse(rec.end) - Date.parse(rec.start)}ms` : "";
        return `${mark} ${rec.cmd}${dur}`;
      },
    }));
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
