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
 *   events.jsonl  append-only structured step events (recorder.event); each
 *                 carries `durationMs` measured from the previous event.
 *   <name>.log    raw captures a command opts into (e.g. check.log).
 *
 * Best-effort by contract: if the run dir cannot be created (read-only
 * repo, no .tmp), beginRun returns null and nothing else in the tool
 * breaks.
 */

import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type WorktreeConfig } from "./config";
import { log } from "./output";
import {
  type RunEvent,
  type RunMeta,
  type RunOutcome,
  type RunRecorder,
  runsRoot,
  writeMeta,
} from "./runlog-types";

export { formatOutcome, listRuns, readRunEvents } from "./runlog-read";
export type { RunEvent, RunMeta, RunOutcome, RunRecorder, SyncOutcome } from "./runlog-types";

function runId(cmd: string): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `${ts}-${process.pid}-${cmd}`;
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
  /** Wall clock of the previous event of THIS run; undefined until the first
   *  one lands, which is why the first event omits durationMs. */
  let lastEventMs: number | undefined;
  const recorder: RunRecorder = {
    dir,
    capturePath: (name: string) => join(dir, name),
    event: (step: string, status: string, detail?: string) => {
      const nowMs = Date.now();
      // Same ms as Date.parse of the ISO ts below (toISOString truncates to
      // ms). Clamped at 0 so a backwards wall clock can never record a
      // negative step cost.
      const durationMs = lastEventMs === undefined ? undefined : Math.max(0, nowMs - lastEventMs);
      lastEventMs = nowMs;
      const ev: RunEvent = {
        v: 1,
        ts: new Date(nowMs).toISOString(),
        step,
        status,
        ...(durationMs !== undefined ? { durationMs } : {}),
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
