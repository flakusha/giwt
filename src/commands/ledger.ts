// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ledger command — dump the shared agent-chat ledger.
 *
 * Usage: giwt ledger [--last N] [--json]
 */

import type { WorktreeConfig } from "../utils/config";
import { formatRecord, LEDGER_DUMP_DEFAULT, LEDGER_MAX_RECORDS, readLedger } from "../utils/ledger";
import { log, raw } from "../utils/output";

export async function ledger(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  let last = LEDGER_DUMP_DEFAULT;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--last") {
      const value = parseInt(args[++i] ?? "", 10);
      if (Number.isFinite(value) && value > 0) last = Math.min(value, LEDGER_MAX_RECORDS);
    } else if (arg.startsWith("--last=")) {
      const value = parseInt(arg.slice("--last=".length), 10);
      if (Number.isFinite(value) && value > 0) last = Math.min(value, LEDGER_MAX_RECORDS);
    } else if (arg === "--json") {
      json = true;
    } else {
      log("error", `unknown flag '${arg}'`);
      raw("  Usage: giwt ledger [--last N] [--json]");
      process.exit(1);
    }
  }

  const records = readLedger(config.treeDir, last);
  if (json) {
    raw(JSON.stringify(records, null, 2));
    return;
  }
  if (records.length === 0) {
    log("info", "Agent ledger is empty — no recent agent activity");
    return;
  }
  for (const record of records) {
    raw(formatRecord(record));
  }
}
