// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Write side of the agent ledger: appending run records and finishing them
 * with terminal outcomes. Split from `ledger.ts` for size only — import
 * paths keep working via re-exports there (same pattern as ledger-core /
 * ledger-read). All filesystem work is best-effort: a ledger failure must
 * never fail the command that triggered it.
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
  type LedgerRecord,
  type LedgerRecordView,
  type LedgerState,
  newRecord,
  normalizeRecord,
} from "./ledger-core";
import { withLedgerLock } from "./ledger-lock";

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

/**
 * Append one record for this run (best-effort: never throws).
 * `branch` is the dispatcher-resolved branch, never a positional;
 * say-flags shape the default message only. `run` is the run-dir
 * basename cross-link. Returns the written record (with seq) or null.
 */
export function appendLedger(
  treeDir: string,
  cmd: string,
  args: string[],
  said: string | null,
  branch: string,
  run?: string,
): LedgerRecord | null {
  return appendRecordLine({
    treeDir,
    cmd,
    args,
    said,
    branch,
    state: "in-progress",
    ...(run === undefined ? {} : { run }),
  });
}

/** Draft + persist one ledger line under the ledger lock. The dispatcher
 * append writes "in-progress" (finishRecord closes it later); appendGripe's
 * fallback writes a terminal state directly because no dispatcher path will
 * ever finish that line. Best-effort: never throws. */
function appendRecordLine(
  { treeDir, cmd, args, said, branch, state, run }: {
    treeDir: string;
    cmd: string;
    args: string[];
    said: string | null;
    branch: string;
    state: LedgerState;
    run?: string;
  },
): LedgerRecord | null {
  try {
    // Never create the directory as a side effect: commands probing a
    // foreign repo (e.g. `abort --dry-run`) resolve treeDir inside it,
    // and mkdir would mutate the very tree dry-run promises to spare.
    // Tradeoff: where treeDir does not exist yet, the run goes unlogged
    // (best-effort ledger; e.g. the first `new` on a fresh host).
    if (!existsSync(treeDir)) return null;
    const base = defaultMessage(cmd, args);
    const msg = truncateMsg(said ? `${base} :: ${said}` : base);
    const path = resolve(treeDir, LEDGER_FILENAME);
    const record = withLedgerLock(treeDir, () => {
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
      const rec = newRecord({
        ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        pid: process.pid,
        agent: process.env.GIWT_AGENT ?? `${hostname()}:${process.pid}`,
        cmd,
        branch,
        msg,
        state,
        seq: lastSeq + 1,
        ...(run === undefined ? {} : { run }),
      });
      lines.push(JSON.stringify(rec));
      writeFileSync(path, `${lines.slice(-LEDGER_MAX_RECORDS).join("\n")}\n`);
      return rec;
    });
    return record;
  } catch { /* ledger must never fail the command */ }
  return null;
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
  // Fallback: no own line to enrich (the silent `gripe` command, finalize's
  // exit-hook gripes, a pruned ledger). Write the terminal record directly —
  // no dispatcher path runs behind these callers, so an in-progress write
  // would strand forever.
  appendRecordLine({
    treeDir,
    cmd: "gripe",
    args: branch === "" ? [] : [branch],
    said: text,
    branch,
    state: "finished",
  });
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
    return withLedgerLock(treeDir, () => {
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
      return "not-found";
    });
  } catch { /* treat as no eligible line */ }
  return "not-found";
}

/**
 * Dispatcher-level terminal write for THIS invocation's ledger line
 * (FEAT-ledger-lifecycle-truthfulness): `main()` calls it after the
 * handler returns (or throws) so no non-silent run's line is left
 * `in-progress` forever. Exit 0 → `finished` / "ok"; any other code →
 * `postponed` / `exit <code>` with a structured error. Command-specific
 * enrichers (appendCommitOutcome, appendGripe) run first and leave the
 * line terminal already — this then finds it "already-done" and writes
 * nothing. Best-effort: never throws.
 *
 * @param treeDir - shared tree directory
 * @param cmd - command name as invoked (pid+cmd scope the line)
 * @param code - real exit code (process.exitCode included)
 * @param message - error detail for non-zero exits (the thrown message)
 */
export function finishOwnLedger(
  treeDir: string,
  cmd: string,
  code: number,
  message?: string,
): EnrichResult {
  if (code === 0) {
    return finishRecord(treeDir, cmd, { state: "finished", text: "ok" });
  }
  return finishRecord(treeDir, cmd, {
    state: "postponed",
    text: `exit ${code}`,
    error: { message: message ?? `exit ${code}`, code },
  });
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
