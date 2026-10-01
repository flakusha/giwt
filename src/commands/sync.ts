// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Sync command — sync ticket index with files + git issues.
 * Runs the internal sync implementation (src/tickets/sync-index.ts)
 * against the managed repo root, in-process.
 */

import { runSync, type SyncSummary } from "../tickets/sync-index";
import { type WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { log, raw, setOutputFormat } from "../utils/output";
import { activeRun } from "../utils/runlog";

export async function sync(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  const hasFix = rest.includes("--fix");
  const hasVerbose = rest.includes("--verbose");
  const hasImport = rest.includes("--import");
  const hasImportBack = rest.includes("--import-back");
  const unknown = rest.filter(
    (a) => a !== "--fix" && a !== "--verbose" && a !== "--import" && a !== "--import-back",
  );
  if (unknown.length > 0) {
    log("error", `unknown flag '${unknown[0]}'`);
    raw(
      "  Usage: giwt sync [--fix] [--import] [--import-back] [--verbose] [--json|--toml|--emoji]",
    );
    process.exit(1);
  }
  if ((hasImport || hasImportBack) && !hasFix) {
    log("error", "--import/--import-back require --fix");
    process.exit(1);
  }
  if (format !== "human") {
    // cli.ts only forces machine format for --json; --toml/--emoji must
    // route the progress log lines to stderr themselves so stdout carries
    // only the payload.
    setOutputFormat("json");
  }

  log("info", "Syncing ticket index...");
  let summary: SyncSummary | null = null;
  // Under machine formats runSync's own human report is administrative
  // traffic: live-forward it to stderr so stdout carries only the record
  // payload (same contract as the run-record announcement).
  const machine = format !== "human";
  const origWrite = process.stdout.write;
  if (machine) {
    process.stdout.write = ((chunk: unknown) => {
      process.stderr.write(chunk as never);
      return true;
    }) as never;
  }
  let exitCode: number;
  try {
    exitCode = runSync(config.worktreeRoot, {
      fix: hasFix,
      verbose: hasVerbose,
      import: hasImport,
      importBack: hasImportBack,
      ticketsPath: config.settings.paths.tickets,
      onSummary: (s) => {
        summary = s;
      },
    });
  } finally {
    if (machine) process.stdout.write = origWrite;
  }
  if (summary !== null) {
    // Outcome lands on the run record BEFORE any exit path: the exit hook
    // backfills end/exitCode only, never outcome data.
    activeRun()?.outcome({ sync: summary });
  }
  if (format !== "human") {
    // Machine record = the sync counters (the run-record outcome payload);
    // a refused run (summary === null) prints an empty payload so stdout
    // still parses cleanly for empty inputs.
    const rec = summary as SyncSummary | null;
    raw(
      rec === null
        ? ""
        : renderRecords(rec, format, {
          emoji: (record) => {
            const s = record as SyncSummary;
            const mark = s.issuesRemaining > 0 ? "⚠️" : "✅";
            return `${mark} tickets: ${s.tickets} · fixes: ${s.fixesApplied}`
              + ` · issues: ${s.issuesRemaining} · advisory: ${s.advisoryRemaining}`;
          },
        }),
    );
  }
  if (exitCode !== 0) {
    log("error", `sync found actionable issues (exit ${exitCode})`);
    process.exit(exitCode);
  }
  if (format === "human") log("success", "Ticket index synced");
}
