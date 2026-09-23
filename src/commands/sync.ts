// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Sync command — sync ticket index with files + git issues.
 * Runs the internal sync implementation (src/tickets/sync-index.ts)
 * against the managed repo root, in-process.
 */

import { runSync, type SyncSummary } from "../tickets/sync-index";
import { type WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";

export async function sync(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const hasFix = args.includes("--fix");
  const hasVerbose = args.includes("--verbose");
  const hasImport = args.includes("--import");
  const hasImportBack = args.includes("--import-back");
  const unknown = args.filter(
    (a) => a !== "--fix" && a !== "--verbose" && a !== "--import" && a !== "--import-back",
  );
  if (unknown.length > 0) {
    log("error", `unknown flag '${unknown[0]}'`);
    raw("  Usage: giwt sync [--fix] [--import] [--import-back] [--verbose]");
    process.exit(1);
  }
  if ((hasImport || hasImportBack) && !hasFix) {
    log("error", "--import/--import-back require --fix");
    process.exit(1);
  }

  log("info", "Syncing ticket index...");
  let summary: SyncSummary | null = null;
  const exitCode = runSync(config.worktreeRoot, {
    fix: hasFix,
    verbose: hasVerbose,
    import: hasImport,
    importBack: hasImportBack,
    ticketsPath: config.settings.paths.tickets,
    onSummary: (s) => {
      summary = s;
    },
  });
  if (summary !== null) {
    // Outcome lands on the run record BEFORE any exit path: the exit hook
    // backfills end/exitCode only, never outcome data.
    activeRun()?.outcome({ sync: summary });
  }
  if (exitCode !== 0) {
    log("error", `sync found actionable issues (exit ${exitCode})`);
    process.exit(exitCode);
  }
  log("success", "Ticket index synced");
}
