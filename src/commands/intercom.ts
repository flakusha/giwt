// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt intercom` — durable inter-agent coordination store.
 *
 * Family dispatch (plan/history shape): one handler, subcommand in arg 0.
 * NOT root-only — every subcommand works from tree/<branch> worktrees; the
 * store is keyed on the repo's common dir/remote, so all lanes of a repo
 * share one store by construction.
 *
 * Ledger/run-record policy (DECISIONS): the family is ledger-silent at the
 * dispatcher level; mutating subcommands manage their own evidence here —
 * beginRun + (claim/done only) appendLedger — because init/gc need the
 * `· run <id>` outcome-line id without a ledger line, while claim/done are
 * ledger-visible (gripe precedent: self-composed records).
 */

import { basename } from "node:path";
import { parseValueFlags } from "../intercom/args";
import { backendFor } from "../intercom/backend";
import { checkLaneName } from "../intercom/claims";
import { runGc } from "../intercom/cmd-gc";
import { runClaim, runDone } from "../intercom/cmd-lanes";
import { runLs, runRead } from "../intercom/cmd-report";
import { printInitSummary, runInit } from "../intercom/cmd-store";
import type { WorktreeConfig } from "../utils/config";
import { parseOutFlags } from "../utils/emit";
import { gitSyncQuiet } from "../utils/git";
import { appendLedger, finishOwnLedger } from "../utils/ledger";
import { log, outcomeLine, raw } from "../utils/output";
import { beginRun, type RunRecorder } from "../utils/runlog";

const SUBCOMMANDS = ["init", "claim", "done", "ls", "read", "gc"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const HELP_LINES = [
  "<init|claim|done|ls|read|gc> [flags]",
  "  init                 resolve the project store, create it, expose .tmp/intercom (idempotent)",
  "  claim <lane>         O_EXCL-claim a lane (--owner <id>, --scope <text>); double claim fails",
  "  done <lane>          record completion (--note <text>, --detail <file> to embed)",
  "  ls [--stale]         derived WHO-DOES-WHAT board (--json/--toml/--emoji)",
  "  read [file]          event tail (--last <n>, --json) or raw store file",
  "  gc [--apply]         retention plan: archive old FIXED, stamp closed lanes stale, compact events",
];

function usageError(message: string): never {
  log("error", message);
  raw(`Usage: giwt intercom ${HELP_LINES[0] ?? ""}`);
  for (const line of HELP_LINES.slice(1)) raw(line);
  process.exit(1);
}

interface MutationOpts {
  sub: Subcommand;
  /** Ledger visibility: claim/done only (init/gc stay ledger-silent). */
  ledger: boolean;
}

/**
 * Run a mutating subcommand under its own run record (+ ledger line for
 * claim/done), closing every evidence surface on both success and error —
 * a mutating command must never strand an in-progress ledger line.
 */
async function mutating(
  config: WorktreeConfig,
  opts: MutationOpts,
  rest: string[],
  action: (rec: RunRecorder | null) => Promise<string>,
): Promise<void> {
  const branch = gitSyncQuiet(config.worktreeRoot, "branch", "--show-current");
  const rec = beginRun(config, "intercom", [opts.sub, ...rest], null, branch);
  const record = opts.ledger
    ? appendLedger(
      config.treeDir,
      "intercom",
      [opts.sub, ...rest],
      null,
      branch,
      ...(rec !== null ? [basename(rec.dir)] : []),
    )
    : null;
  if (rec !== null && record !== null) rec.setLedgerSeq(record.seq);
  let code = 0;
  try {
    const summary = await action(rec);
    rec?.outcome({ intercom: summary });
    outcomeLine(true, summary);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", msg);
    rec?.outcome({ intercom: `failed: ${msg}` });
    outcomeLine(false, msg.length > 60 ? `${msg.slice(0, 57)}…` : msg);
    code = 1;
  }
  rec?.finish(code);
  if (record !== null) finishOwnLedger(config.treeDir, "intercom", code);
  if (code !== 0) process.exit(1);
}

function runInitSub(config: WorktreeConfig, rest: string[]): Promise<void> {
  for (const arg of rest) {
    if (arg !== "--json") usageError(`unknown init flag '${arg}'`);
  }
  const summary = runInit(config.repoRoot, config.worktreeRoot, config.settings.intercom.backend);
  printInitSummary(summary);
  const what = `${summary.created ? "created" : "verified"} ${summary.storeDir}`;
  return mutating(config, { sub: "init", ledger: false }, rest, async () => what);
}

function runClaimSub(config: WorktreeConfig, rest: string[]): Promise<void> {
  const { values, position } = parseValueFlags(rest, ["owner", "scope"], usageError);
  const lane = position[0];
  if (lane === undefined) usageError("claim: a lane name is required");
  checkLaneName(lane);
  const extra = position.length > 1 ? ` unexpected argument '${position[1]}'` : "";
  if (position.length > 1) usageError(`claim:${extra}`);
  return mutating(config, { sub: "claim", ledger: true }, rest, async () => {
    const result = runClaim(config.repoRoot, backend(config), {
      lane,
      ...(values.owner !== undefined ? { owner: values.owner } : {}),
      ...(values.scope !== undefined ? { scope: values.scope } : {}),
    });
    return `claimed ${result.lane} (owner ${result.owner})`;
  });
}

function runDoneSub(config: WorktreeConfig, rest: string[]): Promise<void> {
  const { values, position } = parseValueFlags(rest, ["owner", "note", "detail"], usageError);
  const lane = position[0];
  if (lane === undefined) usageError("done: a lane name is required");
  checkLaneName(lane);
  return mutating(config, { sub: "done", ledger: true }, rest, async () => {
    const result = runDone(config.repoRoot, backend(config), {
      lane,
      ...(values.owner !== undefined ? { owner: values.owner } : {}),
      ...(values.note !== undefined ? { note: values.note } : {}),
      ...(values.detail !== undefined ? { detailPath: values.detail } : {}),
    });
    const claimNote = result.wasClaimed ? "" : " (no claim file — orphan completion)";
    return `done ${result.lane}${claimNote}`;
  });
}

function runLsSub(config: WorktreeConfig, rest: string[]): void {
  const { format, rest: args } = parseOutFlags(rest);
  const staleOnly = args.includes("--stale");
  const flags = args.filter((a) => a !== "--stale");
  for (const arg of flags) usageError(`unknown ls flag '${arg}'`);
  const rows = runLs(config.repoRoot, config.settings.intercom.laneStaleDays, {
    staleOnly,
    format,
  });
  if (format === "human") {
    const stale = rows.filter((r) => r.status === "stale").length;
    log(
      "info",
      `${rows.length} lane(s): ${rows.filter((r) => r.status === "done").length} done, ${
        rows.filter((r) => r.status === "active").length
      } active, ${stale} stale`,
    );
  }
}

function runReadSub(config: WorktreeConfig, rest: string[]): void {
  const { format, rest: args } = parseOutFlags(rest);
  let last = 50;
  const position: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--last" || arg.startsWith("--last=")) {
      const value = arg.startsWith("--last=") ? arg.slice(7) : args[++i];
      const parsed = value === undefined ? Number.NaN : Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        usageError("read: --last must be an integer >= 1");
      }
      last = parsed;
    } else {
      position.push(arg);
    }
  }
  const file = position[0];
  if (position.length > 1) usageError("read: at most one file argument");
  if (file !== undefined && format !== "human") {
    usageError("read: --json/--toml/--emoji apply to the event tail, not file dumps");
  }
  runRead(config.repoRoot, config.settings.intercom.backend, {
    ...(file !== undefined ? { file } : {}),
    last,
    json: format === "json",
  });
}

function runGcSub(config: WorktreeConfig, rest: string[]): Promise<void> {
  let apply = false;
  for (const arg of rest) {
    if (arg === "--apply") apply = true;
    else usageError(`unknown gc flag '${arg}'`);
  }
  return mutating(config, { sub: "gc", ledger: false }, rest, async () => {
    const plan = runGc(config.repoRoot, {
      apply,
      backendName: config.settings.intercom.backend,
      retention: {
        fixedArchiveDays: config.settings.intercom.fixedArchiveDays,
        laneStaleDays: config.settings.intercom.laneStaleDays,
        eventKeep: config.settings.intercom.eventKeep,
      },
    });
    const verb = apply ? "applied" : "plan";
    return `${verb}: ${plan.archived.length} archived, ${plan.stamped.length} stamped, events ${plan.eventsBefore}->${plan.eventsAfter}, ${plan.orphans.length} orphan(s)`;
  });
}

function backend(config: WorktreeConfig) {
  return backendFor(config.settings.intercom.backend);
}

export async function intercom(args: string[], config: WorktreeConfig): Promise<void> {
  const sub = args[0];
  if (sub === undefined || !(SUBCOMMANDS as readonly string[]).includes(sub)) {
    usageError(sub === undefined ? "a subcommand is required" : `unknown subcommand '${sub}'`);
  }
  const rest = args.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    for (const line of HELP_LINES) raw(line);
    return;
  }
  switch (sub as Subcommand) {
    case "init":
      return runInitSub(config, rest);
    case "claim":
      return runClaimSub(config, rest);
    case "done":
      return runDoneSub(config, rest);
    case "ls":
      return runLsSub(config, rest);
    case "read":
      return runReadSub(config, rest);
    case "gc":
      return runGcSub(config, rest);
  }
}
