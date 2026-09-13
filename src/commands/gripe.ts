// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Gripe command — let agents vent at each other on the shared ledger.
 *
 * Usage: giwt gripe [--at <branch>] <message...>
 *
 * The message is free text ("you left dev mid-merge again"); --at tags
 * which branch/agent it's aimed at. Stored as a `gripe` ledger record so
 * it shows up in `worktree ledger` and `finalize` dumps alongside the
 * auto-appended run records. Self-logging: the dispatcher skips the
 * generic auto-append for this command (see LEDGER_SILENT_COMMANDS).
 */

import type { WorktreeConfig } from "../utils/config";
import { appendGripe, formatRecord, readLedger } from "../utils/ledger";
import { log, raw } from "../utils/output";

export async function gripe(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  let at = "";
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--at") {
      const value = args[++i];
      if (value === undefined || value.trim().length === 0) {
        log("error", "--at requires a branch name");
        raw("  Usage: giwt gripe [--at <branch>] <message...>");
        process.exit(1);
      }
      at = value;
    } else if (arg.startsWith("--at=")) {
      const value = arg.slice("--at=".length);
      if (value.trim().length > 0) at = value;
    } else {
      words.push(arg);
    }
  }

  const message = words.join(" ").trim();
  if (message.length === 0) {
    log("error", "gripe message required");
    raw("  Usage: giwt gripe [--at <branch>] <message...>");
    process.exit(1);
  }

  appendGripe(config.treeDir, at, message);
  const latest = readLedger(config.treeDir, 1).at(-1);
  log("success", "Gripe recorded — the ledger remembers");
  if (latest) raw(`  ${formatRecord(latest)}`);
}
