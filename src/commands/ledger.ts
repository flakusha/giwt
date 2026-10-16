// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Ledger command — dump the shared agent-chat ledger.
 *
 * Usage: giwt ledger [--last N] [--json] [--state <s>] [--cmd <name>] [--branch <b>]
 */

import { scanFlags, type ScanResult } from "../utils/args-scan";
import type { WorktreeConfig } from "../utils/config";
import {
  formatRecord,
  LEDGER_DUMP_DEFAULT,
  LEDGER_MAX_RECORDS,
  type LedgerRecordView,
  readLedger,
} from "../utils/ledger";
import { log, raw } from "../utils/output";

const LEDGER_FLAGS = {
  "--last": { value: "required" },
  "--json": { value: "none" },
  "--state": { value: "required" },
  "--cmd": { value: "required" },
  "--branch": { value: "required" },
} as const;

interface LedgerFilter {
  state?: string;
  cmd?: string;
  branch?: string;
}

function parseLedgerArgs(args: string[]): { json: boolean; last: number; filter: LedgerFilter; } {
  let scan: ScanResult;
  try {
    scan = scanFlags(args, LEDGER_FLAGS);
  } catch (error) {
    log("error", (error as Error).message);
    log(
      "error",
      "usage: giwt ledger [--last N] [--json] [--state <s>] [--cmd <name>] [--branch <b>]",
    );
    process.exit(1);
  }
  if (scan.positionals.length > 0) {
    log("error", `unknown flag '${scan.positionals[0]}'`);
    log(
      "error",
      "usage: giwt ledger [--last N] [--json] [--state <s>] [--cmd <name>] [--branch <b>]",
    );
    process.exit(1);
  }
  const lastRaw = scan.flags["--last"];
  const last = typeof lastRaw === "string" ? parseInt(lastRaw, 10) : LEDGER_DUMP_DEFAULT;
  return {
    json: scan.flags["--json"] === true,
    last: Number.isFinite(last) && last > 0
      ? Math.min(last, LEDGER_MAX_RECORDS)
      : LEDGER_DUMP_DEFAULT,
    filter: {
      ...(typeof scan.flags["--state"] === "string" ? { state: scan.flags["--state"] } : {}),
      ...(typeof scan.flags["--cmd"] === "string" ? { cmd: scan.flags["--cmd"] } : {}),
      ...(typeof scan.flags["--branch"] === "string" ? { branch: scan.flags["--branch"] } : {}),
    },
  };
}

/** Pure post-filter over the read records (exact matches). */
function applyFilter(records: LedgerRecordView[], f: LedgerFilter): LedgerRecordView[] {
  return records.filter((r) =>
    (f.state === undefined || r.state === f.state)
    && (f.cmd === undefined || r.cmd === f.cmd)
    && (f.branch === undefined || r.branch === f.branch)
  );
}

export async function ledger(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { json, last, filter } = parseLedgerArgs(args);

  const records = applyFilter(readLedger(config.treeDir, last), filter);
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
