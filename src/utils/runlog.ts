// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Run records — per-invocation evidence trail under the MAIN repo scratchpad.
 *
 * Every dispatched (non-silent) command gets a pre-set, announced run dir:
 *   <repoRoot>/<paths.runlog>/runs/<YYYYMMDD-HHMMSS>-<pid>-<cmd>/
 *
 * Records deliberately live under repoRoot, not worktreeRoot: a successful
 * `finalize` removes the worktree, and evidence that dies with it answers
 * nothing the day after. Unique dirs (timestamp + pid) keep parallel
 * worktree invocations from colliding in the shared root.
 *
 * Layout per run:
 *   meta.json     structured run summary (written at begin, updated by
 *                 recorder.outcome, finalized at finish). A record WITHOUT
 *                 end/exitCode now only means an abnormal termination that
 *                 bypassed every handler (SIGKILL) — the dispatch-level
 *                 catch, direct process.exit calls inside handlers, and
 *                 plain returns with a set process.exitCode all land here
 *                 via the module exit hook.
 *   outcome       an optional outcome summary (failing gates, merge commit,
 *                 sync counts, doctor line) attached by the command.
 *   events.jsonl  append-only structured step events (recorder.event).
 *   <name>.log    raw captures a command opts into (e.g. check.log).
 *
 * Best-effort by contract: if the run dir cannot be created (read-only
 * repo, no .tmp), beginRun returns null and nothing else in the tool
 * breaks.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { type WorktreeConfig } from "./config";
import { log } from "./output";

/** Ticket-index sync counts, as recorded by the `sync` command. */
export interface SyncOutcome {
  /** Ticket .md files scanned. */
  tickets: number;
  /** Automatic fixes applied to the index (--fix mode). */
  fixesApplied: number;
  /** Actionable issues remaining after the run (drives the exit code). */
  issuesRemaining: number;
  /** Advisory (non-gating) findings remaining. */
  advisoryRemaining: number;
}

/** Outcome summary a command attaches to its own run record. */
export interface RunOutcome {
  /** Gates/checks that failed (finalize gates, doctor check ids). */
  failedGates?: string[] | undefined;
  /** HEAD of the target branch after a successful finalize merge. */
  mergeCommit?: string | undefined;
  /** Ticket-sync counts (sync command). */
  sync?: SyncOutcome | undefined;
  /** One-line doctor summary. */
  doctor?: string | undefined;
  /** One-line clean summary (scratchpad bytes freed). */
  clean?: string | undefined;
}

export interface RunMeta {
  v: 1;
  cmd: string;
  args: string[];
  said: string | null;
  pid: number;
  repoRoot: string;
  /** Resolved current branch at dispatch (`git branch --show-current`);
   *  "" on detached HEAD. Shared with the ledger record for the run. */
  branch: string;
  start: string;
  end?: string;
  exitCode?: number;
  outcome?: RunOutcome | undefined;
}

export interface RunEvent {
  v: 1;
  ts: string;
  step: string;
  status: string;
  detail?: string;
}

export interface RunRecorder {
  /** Absolute run dir — also the value announced before dispatch. */
  dir: string;
  /** Absolute path for a raw capture file inside the run dir. */
  capturePath: (name: string) => string;
  event: (step: string, status: string, detail?: string) => void;
  /** Attach/merge outcome data onto meta.json. Incremental: each call
   *  merges the given keys, so partial summaries stay visible even before
   *  finish (best-effort, never throws). */
  outcome: (partial: RunOutcome) => void;
  /** Write end + exitCode. Idempotent: later calls and the exit hook are
   *  no-ops after the first. */
  finish: (exitCode: number) => void;
}

function runsRoot(config: WorktreeConfig): string {
  // repoRoot, NOT worktreeRoot: finalize removes the worktree and must not
  // take its own evidence with it (FIX-run-records-die-with-the-worktree).
  return resolve(config.repoRoot, config.settings.paths.runlog, "runs");
}

function runId(cmd: string): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `${ts}-${process.pid}-${cmd}`;
}

function writeMeta(dir: string, meta: RunMeta): void {
  try {
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  } catch { /* best-effort */ }
}

// Module-scoped active run: commands reach the recorder via activeRun()
// without changing their (args, config) signature. Mirrors the module-state
// precedent in commands/finalize.ts (ACTIVE_ABORT_STATE).
let ACTIVE_RUN: RunRecorder | null = null;
/** Whether ACTIVE_RUN already wrote its terminal meta (guards the exit hook). */
let ACTIVE_RUN_FINISHED = true;
let EXIT_HOOK_INSTALLED = false;

/**
 * Terminal write for the active run — the body of the process exit hook,
 * exported so tests (and embedders with their own exit handling) can drive
 * it directly. Backfills end/exitCode for a run its handler left
 * unfinished: the `process.exit(1)` paths deep inside commands (finalize
 * gates, doctor check, sync) bypass the dispatch-level try/catch and never
 * call finish(). Already-finished runs no-op. Limitation: with nested runs
 * only the innermost ACTIVE_RUN is seen — same caveat as finalize's exit
 * gripe hook.
 */
export function finishActiveRun(exitCode: number): void {
  if (ACTIVE_RUN === null || ACTIVE_RUN_FINISHED) return;
  ACTIVE_RUN.finish(exitCode);
  // A finished run is not active: clear the pointer so later work in the same
  // process (a second command, or a test file following one that drove a run)
  // cannot inherit this run's dir via activeRun() — observed as finalize
  // writing its check.log into a previous test's run directory.
  ACTIVE_RUN = null;
  ACTIVE_RUN_FINISHED = true;
}

/**
 * Install the once-per-process exit hook; its body lives in the exported
 * finishActiveRun().
 */
function ensureExitHook(): void {
  if (EXIT_HOOK_INSTALLED) return;
  EXIT_HOOK_INSTALLED = true;
  process.on("exit", () => {
    // process.exit() with no argument means code 0; every error path sets a
    // numeric process.exitCode before exiting (Bun populates it before the
    // exit event fires).
    finishActiveRun(typeof process.exitCode === "number" ? process.exitCode : 0);
  });
}

/** Recorder for the invocation in flight, or null when none/best-effort failed. */
export function activeRun(): RunRecorder | null {
  return ACTIVE_RUN;
}

/**
 * Start a run record: create the dir, write meta.json, announce the
 * location. Returns null when the scratchpad is not creatable.
 */
export function beginRun(
  config: WorktreeConfig,
  cmd: string,
  args: string[],
  said: string | null,
  /** Resolved current branch for meta.branch; the dispatcher computes it
   *  once and shares it with the ledger so both records agree. */
  branch: string,
): RunRecorder | null {
  const root = runsRoot(config);
  const dir = join(root, runId(cmd));
  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(dir);
  } catch {
    return null; // best-effort: read-only repo or hostile umask
  }

  const meta: RunMeta = {
    v: 1,
    cmd,
    args,
    said,
    pid: process.pid,
    repoRoot: config.repoRoot,
    branch,
    start: new Date().toISOString(),
  };
  writeMeta(dir, meta);
  pruneRuns(root, config.settings.runlog.maxRuns);
  log("info", `Run record: ${dir}`);

  let finished = false;
  const recorder: RunRecorder = {
    dir,
    capturePath: (name: string) => join(dir, name),
    event: (step: string, status: string, detail?: string) => {
      const ev: RunEvent = {
        v: 1,
        ts: new Date().toISOString(),
        step,
        status,
        ...(detail !== undefined ? { detail } : {}),
      };
      try {
        appendFileSync(join(dir, "events.jsonl"), JSON.stringify(ev) + "\n");
      } catch { /* best-effort */ }
    },
    outcome: (partial: RunOutcome) => {
      meta.outcome = { ...meta.outcome, ...partial };
      writeMeta(dir, meta);
    },
    finish: (exitCode: number) => {
      if (finished) return;
      finished = true;
      meta.end = new Date().toISOString();
      meta.exitCode = exitCode;
      writeMeta(dir, meta);
      if (ACTIVE_RUN === recorder) ACTIVE_RUN_FINISHED = true;
    },
  };
  ACTIVE_RUN = recorder;
  ACTIVE_RUN_FINISHED = false;
  ensureExitHook();
  return recorder;
}

/** Remove oldest run dirs beyond `maxRuns` (best-effort). */
function pruneRuns(root: string, maxRuns: number): void {
  try {
    const entries = readdirSync(root).sort();
    for (const name of entries.slice(0, Math.max(0, entries.length - maxRuns))) {
      rmSync(join(root, name), { recursive: true, force: true });
    }
  } catch { /* best-effort */ }
}

/**
 * Read run records newest-first. Corrupt/missing meta.json rows are
 * skipped; `last` caps the result (default 20).
 */
export function listRuns(
  config: WorktreeConfig,
  last = 20,
): Array<RunMeta & { dir: string; }> {
  const root = runsRoot(config);
  if (!existsSync(root)) return [];
  const out: Array<RunMeta & { dir: string; }> = [];
  try {
    const names = readdirSync(root).sort().toReversed();
    for (const name of names) {
      const dir = join(root, name);
      try {
        const parsed = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as RunMeta;
        if (parsed && parsed.v === 1 && typeof parsed.cmd === "string") {
          out.push({ ...parsed, dir });
        }
      } catch { /* skip corrupt row */ }
      if (out.length >= last) break;
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * Compact one-line human rendering of a run outcome, for `giwt runs`.
 *
 * @param outcome - outcome summary from meta.json
 * @returns "; "-joined summary, or "" when the record has no outcome data
 */
export function formatOutcome(outcome: RunOutcome | undefined): string {
  if (!outcome) return "";
  const parts: string[] = [];
  if (outcome.failedGates && outcome.failedGates.length > 0) {
    parts.push(`failed: ${outcome.failedGates.join(",")}`);
  }
  if (outcome.mergeCommit) parts.push(`merged: ${outcome.mergeCommit.slice(0, 9)}`);
  if (outcome.sync) {
    parts.push(
      `sync: ${outcome.sync.fixesApplied} fixed, ${outcome.sync.issuesRemaining} remaining`
        + (outcome.sync.advisoryRemaining > 0
          ? ` (${outcome.sync.advisoryRemaining} advisory)`
          : ""),
    );
  }
  if (outcome.doctor) parts.push(`doctor: ${outcome.doctor}`);
  if (outcome.clean) parts.push(`clean: ${outcome.clean}`);
  return parts.join("; ");
}
