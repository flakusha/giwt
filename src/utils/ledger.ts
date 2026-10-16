// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
/**
 * Agent ledger — shared "agent chat" for worktree CLI invocations.
 *
 * Every CLI run appends one compact record to `<treeDir>/.ledger.jsonl`
 * (JSONL, one object per line). `tree/` is gitignored, so the ledger is
 * shared root state on this host without ever entering a commit.
 *
 * Record (single line, chat-compact):
 *   {"v":2,"ts":"2026-09-10T06:55:01Z","pid":1234,"agent":"host:1234","cmd":"new","branch":"foo","msg":"new foo :: working on auth","state":"in-progress","seq":7}
 *
 * Limits keep it small and greppable:
 *   - msg capped at LEDGER_MAX_MSG chars (chat-like, truncated with …)
 *   - file capped at LEDGER_MAX_RECORDS lines (oldest pruned on append)
 *   - dumps default to LEDGER_DUMP_DEFAULT records
 *
 * All filesystem work is best-effort: a ledger failure must never fail
 * the command that triggered it.
 */

// Re-exported so `./utils/ledger` import paths keep working while the
// implementation is split for size: schema primitives in ledger-core,
// read side in ledger-read, write side in ledger-write.
export { formatRecord, LEDGER_FILENAME, LEDGER_MAX_MSG, LEDGER_MAX_RECORDS } from "./ledger-core";
export type { LedgerRecord, LedgerRecordView } from "./ledger-core";
export { LEDGER_DUMP_DEFAULT, printRecentLedger, readLedger } from "./ledger-read";
export {
  appendCommitOutcome,
  appendGripe,
  appendLedger,
  defaultMessage,
  finishOwnLedger,
  finishRecord,
  truncateMsg,
} from "./ledger-write";
export type { LedgerOutcome } from "./ledger-write";

/** Commands that skip the generic auto-append (readers; `gripe` composes its own richer record). */
export const LEDGER_SILENT_COMMANDS: Record<string, true> = {
  gripe: true,
  help: true,
  ledger: true,
  plan: true,
  runs: true,
  task: true,
};

export interface SayArgs {
  /** Args with `--say`/`--ledger-msg` and its value removed. */
  cleanArgs: string[];
  /** Free-text context from the flag, or null when absent. */
  said: string | null;
}

/**
 * Pull `--say <text>` / `--ledger-msg <text>` (or `--flag=<text>`) out of
 * raw command args. Long-only flags: `-m`/`-F` stay owned by commit flows.
 *
 * @param args - raw command arguments
 * @returns cleaned args and the said text (or null)
 */
export function extractSayArgs(args: readonly string[]): SayArgs {
  const cleanArgs: string[] = [];
  let said: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--say" || arg === "--ledger-msg") {
      const value = args[++i] ?? "";
      said = value.trim().length > 0 ? value : said;
    } else if (arg.startsWith("--say=") || arg.startsWith("--ledger-msg=")) {
      const value = arg.slice(arg.indexOf("=") + 1);
      if (value.trim().length > 0) said = value;
    } else {
      cleanArgs.push(arg);
    }
  }
  return { cleanArgs, said };
}
