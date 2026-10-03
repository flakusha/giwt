// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300
/**
 * Read side of the agent ledger: parsing recent records and the stdout
 * dump. Split from `ledger.ts` for size only — import paths keep working
 * via re-exports there.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "path";
import {
  formatRecord,
  LEDGER_FILENAME,
  LEDGER_MAX_RECORDS,
  type LedgerRecordView,
  normalizeRecord,
} from "./ledger-core";
import { log, raw } from "./output";

export const LEDGER_DUMP_DEFAULT = 10;

/**
 * Read the latest records, oldest-first. Returns [] when missing/corrupt.
 *
 * @param treeDir - shared tree directory
 * @param last - max records to return (capped at LEDGER_MAX_RECORDS)
 * @returns parsed records, oldest first
 */
export function readLedger(treeDir: string, last: number): LedgerRecordView[] {
  const capped = Math.max(1, Math.min(last, LEDGER_MAX_RECORDS));
  try {
    const path = resolve(treeDir, LEDGER_FILENAME);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
    const out: LedgerRecordView[] = [];
    for (const line of lines.slice(-capped)) {
      try {
        const parsed = normalizeRecord(JSON.parse(line));
        if (parsed !== null) out.push(parsed);
      } catch { /* skip corrupt line */ }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Dump the latest records to stdout (the shared-state view `finalize`
 * shows before mutating dev). Placeholder when the ledger is empty.
 *
 * @param treeDir - shared tree directory
 * @param count - records to show (default LEDGER_DUMP_DEFAULT)
 */
export function printRecentLedger(treeDir: string, count: number = LEDGER_DUMP_DEFAULT): void {
  const records = readLedger(treeDir, count);
  if (records.length === 0) {
    log("info", "Agent ledger is empty — no recent agent activity");
    return;
  }
  log("info", `Agent ledger (last ${records.length}):`);
  for (const record of records) {
    raw(`  ${formatRecord(record)}`);
  }
}
