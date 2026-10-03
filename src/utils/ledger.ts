// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300
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

import { existsSync } from "fs";
import { readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "path";
import {
  LEDGER_FILENAME,
  LEDGER_MAX_MSG,
  LEDGER_MAX_RECORDS,
  type LedgerError,
  type LedgerRecordView,
  newRecord,
  normalizeRecord,
} from "./ledger-core";

// Re-exported so `./utils/ledger` import paths keep working while the
// pure schema primitives live in ledger-core (read side in ledger-read).
export { formatRecord, LEDGER_FILENAME, LEDGER_MAX_MSG, LEDGER_MAX_RECORDS } from "./ledger-core";
export type { LedgerError, LedgerRecord } from "./ledger-core";
export { LEDGER_DUMP_DEFAULT, printRecentLedger, readLedger } from "./ledger-read";

/** Commands that skip the generic auto-append (readers; `gripe` composes its own richer record). */
export const LEDGER_SILENT_COMMANDS: Record<string, true> = {
  gripe: true,
  help: true,
  ledger: true,
  plan: true,
  runs: true,
  task: true,
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
 * @param args - command args (say-flags already stripped; they shape the
 *   default message only, never the branch field)
 * @param said - optional free-text context from --say
 * @param branch - resolved current branch (the dispatcher computes it once
 *   from `git branch --show-current` and shares it with the run record's
 *   meta.branch; "" when unknown). Positional args are NOT a branch source:
 *   `doctor check` would record the subcommand, `sync` nothing at all.
 */
export function appendLedger(
  treeDir: string,
  cmd: string,
  args: string[],
  said: string | null,
  branch: string,
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
    const path = resolve(treeDir, LEDGER_FILENAME);
    const lines = existsSync(path)
      ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0)
      : [];
    // v1 lines normalize to seq 0, so the first v2 line in an old file is seq 1.
    let lastSeq = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = normalizeRecord(JSON.parse(lines[i]!));
        if (parsed !== null) {
          lastSeq = parsed.seq;
          break;
        }
      } catch { /* skip corrupt line, keep hunting for the newest seq */ }
    }
    const record = newRecord({
      ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      pid: process.pid,
      agent: process.env.GIWT_AGENT ?? `${hostname()}:${process.pid}`,
      cmd,
      branch,
      msg,
      state: "in-progress",
      seq: lastSeq + 1,
    });
    lines.push(JSON.stringify(record));
    writeFileSync(path, `${lines.slice(-LEDGER_MAX_RECORDS).join("\n")}\n`);
  } catch { /* ledger must never fail the command */ }
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
  // The [branch] arg only shapes the fallback append's default message; the
  // resolved branch is passed explicitly so the field never lies.
  const text = `😤 ${message}`;
  if (finishRecord(treeDir, "gripe", { state: "finished", text }) !== "not-found") return;
  appendLedger(treeDir, "gripe", branch === "" ? [] : [branch], text, branch);
}
/** Structured outcome handed to finishRecord by its thin wrappers. */
export interface LedgerOutcome {
  /** Terminal lifecycle for the record. */
  state: "finished" | "postponed";
  /** Human-readable outcome text appended to the record's msg. */
  text: string;
  /** Optional structured failure detail (e.g. a postponed gate list). */
  error?: LedgerError;
}

/** Outcome of hunting for this invocation's own ledger line. */
type EnrichResult = "enriched" | "already-done" | "not-found";

/**
 * Finish the newest ledger line of THIS invocation (same pid + cmd) in
 * place with `outcome`: the line's state moves to finished/postponed and
 * the human text is appended to its msg (`:: <text>`), with an optional
 * error object attached. "not-found" (missing ledger, pruned past the
 * cap, I/O error) lets the caller fall back to a plain append;
 * "already-done" means the line carries a terminal state already and
 * must be left alone.
 */
export function finishRecord(treeDir: string, cmd: string, outcome: LedgerOutcome): EnrichResult {
  try {
    if (!existsSync(treeDir)) return "not-found";
    const path = resolve(treeDir, LEDGER_FILENAME);
    if (!existsSync(path)) return "not-found";
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === undefined || line.trim().length === 0) continue;
      let rec: LedgerRecordView | null;
      try {
        rec = normalizeRecord(JSON.parse(line));
      } catch {
        continue;
      }
      if (rec === null) continue;
      // Newest-to-oldest scan for THIS invocation's line (same pid +
      // cmd); records from other runs are skipped, not barriers.
      if (rec.pid !== process.pid || rec.cmd !== cmd) continue;
      // A terminal state is written only by finishRecord, so a matching
      // line either awaits enrichment or is already done.
      if (rec.state === "finished" || rec.state === "postponed") return "already-done";
      rec.state = outcome.state;
      rec.msg = truncateMsg(`${rec.msg} :: ${outcome.text}`);
      if (outcome.error !== undefined) rec.error = outcome.error;
      lines[i] = JSON.stringify(rec);
      writeFileSync(path, lines.join("\n"));
      return "enriched";
    }
  } catch { /* treat as no eligible line */ }
  return "not-found";
}

/**
 * Record a commit outcome so the shared ledger shows what landed, not just
 * that a commit ran. Called by `commit` and `commit-wt` after a successful
 * GPG-signed commit. The dispatch auto-append already wrote exactly one
 * line for this invocation (same pid + cmd), so this ENRICHES that line in
 * place — `:: ✅ <short-sha> <subject>` — instead of appending a duplicate.
 * When the invocation line is gone (missing ledger, pruned past the cap,
 * unparseable), it falls back to a supplement line. Either way the commit
 * lands as exactly one ✅-carrying line. Best-effort: never throws.
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
  const outcome: LedgerOutcome = {
    state: "finished",
    text: `✅ ${sha.slice(0, 9)} ${firstLine}`,
  };
  // "already-done" lands here too: the commit is recorded, appending again
  // would resurrect the double-line bug this function exists to prevent.
  if (finishRecord(treeDir, cmd, outcome) !== "not-found") return;
  appendLedger(treeDir, cmd, branch === "" ? [] : [branch], outcome.text, branch);
}
