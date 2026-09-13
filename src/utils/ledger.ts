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
 *   {"v":1,"ts":"2026-09-10T06:55:01Z","pid":1234,"cmd":"new","branch":"foo","msg":"new foo :: working on auth"}
 *
 * Limits keep it small and greppable:
 *   - msg capped at LEDGER_MAX_MSG chars (chat-like, truncated with …)
 *   - file capped at LEDGER_MAX_RECORDS lines (oldest pruned on append)
 *   - dumps default to LEDGER_DUMP_DEFAULT records
 *
 * All filesystem work is best-effort: a ledger failure must never fail
 * the command that triggered it.
 */

import { existsSync } from "fs";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "path";
import { log, raw } from "./output";

export interface LedgerRecord {
  v: 1;
  /** ISO-8601 UTC, seconds precision. */
  ts: string;
  pid: number;
  cmd: string;
  /** First positional arg hint (usually a branch); "" when none. */
  branch: string;
  msg: string;
}

export const LEDGER_FILENAME = ".ledger.jsonl";
export const LEDGER_MAX_RECORDS = 50;
export const LEDGER_MAX_MSG = 280;
export const LEDGER_DUMP_DEFAULT = 10;

/** Commands that skip the generic auto-append: readers, plus writers
 * like `gripe` that compose their own richer record. */
export const LEDGER_SILENT_COMMANDS: Record<string, true> = {
  gripe: true,
  help: true,
  ledger: true,
  runs: true,
};

/**
 * Collapse whitespace and cap length so one record stays one short line.
 *
 * @param msg - raw message text
 * @returns trimmed single-space string, at most LEDGER_MAX_MSG chars
 */
export function truncateMsg(msg: string): string {
  const collapsed = msg.trim().replace(/\s+/g, " ");
  if (collapsed.length <= LEDGER_MAX_MSG) return collapsed;
  return `${collapsed.slice(0, LEDGER_MAX_MSG - 1)}…`;
}

/**
 * Default ledger message for a run: `cmd` plus the first positional arg
 * (usually the branch), e.g. `finalize my-feature`.
 *
 * @param cmd - command name as invoked
 * @param args - command args (say-flags already stripped)
 * @returns default message text
 */
export function defaultMessage(cmd: string, args: string[]): string {
  const positional = args.filter((a) => !a.startsWith("-"));
  const target = positional[0] ?? "";
  return target ? `${cmd} ${target}` : cmd;
}

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

/**
 * Append one record for this run. Best-effort: never throws.
 *
 * @param treeDir - shared tree directory (ledger lives inside it)
 * @param cmd - command name as invoked
 * @param args - command args (say-flags already stripped)
 * @param said - optional free-text context from --say
 */
export function appendLedger(
  treeDir: string,
  cmd: string,
  args: string[],
  said: string | null,
): void {
  try {
    // Never create the directory as a side effect: commands probing a
    // foreign repo (e.g. `abort --dry-run`) resolve treeDir inside it,
    // and mkdir would mutate the very tree dry-run promises to spare.
    // Tradeoff: where treeDir does not exist yet, the run goes unlogged
    // (best-effort ledger; e.g. the first `new` on a fresh host).
    if (!existsSync(treeDir)) return;
    const base = defaultMessage(cmd, args);
    const msg = truncateMsg(said ? `${base} :: ${said}` : base);
    const record: LedgerRecord = {
      v: 1,
      ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      pid: process.pid,
      cmd,
      branch: args.filter((a) => !a.startsWith("-"))[0] ?? "",
      msg,
    };
    const path = resolve(treeDir, LEDGER_FILENAME);
    const lines = existsSync(path)
      ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0)
      : [];
    lines.push(JSON.stringify(record));
    writeFileSync(path, `${lines.slice(-LEDGER_MAX_RECORDS).join("\n")}\n`);
  } catch { /* ledger must never fail the command */ }
}

/**
 * Read the latest records, oldest-first. Returns [] when missing/corrupt.
 *
 * @param treeDir - shared tree directory
 * @param last - max records to return (capped at LEDGER_MAX_RECORDS)
 * @returns parsed records, oldest first
 */
export function readLedger(treeDir: string, last: number): LedgerRecord[] {
  const capped = Math.max(1, Math.min(last, LEDGER_MAX_RECORDS));
  try {
    const path = resolve(treeDir, LEDGER_FILENAME);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
    const out: LedgerRecord[] = [];
    for (const line of lines.slice(-capped)) {
      try {
        const parsed = JSON.parse(line) as LedgerRecord;
        if (parsed && parsed.v === 1 && typeof parsed.msg === "string") out.push(parsed);
      } catch { /* skip corrupt line */ }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * One-line chat rendering: `[09-10 06:55] [#1234] [branch] cmd: msg`.
 *
 * @param record - ledger record to render
 * @returns single display line
 */
export function formatRecord(record: LedgerRecord): string {
  const shortTs = record.ts.slice(5, 16).replace("T", " ");
  const branch = record.branch.length > 0 ? record.branch : "-";
  return `[${shortTs}] [#${record.pid}] [${branch}] ${record.cmd}: ${record.msg}`;
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
/**
 * Record a gripe: a `gripe`-cmd ledger record with the 😤 prefix.
 * Same shape the `gripe` command writes by hand; also used for
 * automatic failure gripes (e.g. finalize). Best-effort: never throws.
 *
 * @param treeDir - shared tree directory
 * @param branch - target branch hint ("" when unknown)
 * @param message - gripe text without the emoji prefix
 */
export function appendGripe(treeDir: string, branch: string, message: string): void {
  appendLedger(treeDir, "gripe", branch === "" ? [] : [branch], `😤 ${message}`);
}
/**
 * Record a commit outcome: a `<cmd>`-cmd ledger record carrying the new
 * commit's short SHA plus subject line. Called by `commit` and
 * `commit-wt` after a successful GPG-signed commit so the shared
 * ledger shows what landed, not just that a commit ran (the generic
 * auto-append in `index.ts` records the invocation). Best-effort.
 *
 * @param treeDir - shared tree directory
 * @param cmd - "commit" or "commit-wt"
 * @param branch - committed branch ("" when unknown)
 * @param sha - full commit SHA (shortened to 9 chars)
 * @param subject - commit message (first line only)
 */
export function appendCommitOutcome(
  treeDir: string,
  cmd: string,
  branch: string,
  sha: string,
  subject: string,
): void {
  const firstLine = (subject.split("\n")[0] ?? "").trim();
  appendLedger(treeDir, cmd, branch === "" ? [] : [branch], `✅ ${sha.slice(0, 9)} ${firstLine}`);
}
