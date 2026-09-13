// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Sync command — sync ticket index with files + git issues.
 * Runs the internal sync implementation (src/tickets/sync-index.ts)
 * against the managed repo root, in-process.
 */

import { runSync } from "../tickets/sync-index";
import { type WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";

export async function sync(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const hasFix = args.includes("--fix");
  const hasVerbose = args.includes("--verbose");
  const unknown = args.filter((a) => a !== "--fix" && a !== "--verbose");
  if (unknown.length > 0) {
    log("error", `unknown flag '${unknown[0]}'`);
    raw("  Usage: giwt sync [--fix] [--verbose]");
    process.exit(1);
  }

  log("info", "Syncing ticket index...");
  const exitCode = runSync(config.worktreeRoot, {
    fix: hasFix,
    verbose: hasVerbose,
    ticketsPath: config.settings.paths.tickets,
  });
  if (exitCode !== 0) {
    log("error", `sync found actionable issues (exit ${exitCode})`);
    process.exit(exitCode);
  }
  log("success", "Ticket index synced");
}
