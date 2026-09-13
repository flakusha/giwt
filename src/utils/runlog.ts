// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Run records — per-invocation evidence trail under the repo scratchpad.
 *
 * Every dispatched (non-silent) command gets a pre-set, announced run dir:
 *   <repoRoot>/<paths.runlog>/runs/<YYYYMMDD-HHMMSS>-<pid>-<cmd>/
 *
 * Layout per run:
 *   meta.json     structured run summary (written at begin, updated at
 *                 finish). A record WITHOUT end/exitCode means the command
 *                 terminated abnormally (process.exit deep inside a command
 *                 or SIGKILL) — an analyzable signal, not a gap.
 *   events.jsonl  append-only structured step events (recorder.event).
 *   <name>.log    raw captures a command opts into (e.g. check.log).
 *
 * Best-effort by contract: if the run dir cannot be created (read-only
 * repo, no .tmp), beginRun returns null and nothing else in the tool
 * breaks. Unique dirs per run (timestamp + pid) keep parallel invocations
 * from colliding.
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
import { gitSyncQuiet } from "./git";
import { log } from "./output";

export interface RunMeta {
  v: 1;
  cmd: string;
  args: string[];
  said: string | null;
  pid: number;
  repoRoot: string;
  branch: string;
  start: string;
  end?: string;
  exitCode?: number;
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
  finish: (exitCode: number) => void;
}

function runsRoot(config: WorktreeConfig): string {
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
    branch: gitSyncQuiet(config.repoRoot, "branch", "--show-current"),
    start: new Date().toISOString(),
  };
  writeMeta(dir, meta);
  pruneRuns(root, config.settings.runlog.maxRuns);
  log("info", `Run record: ${dir}`);

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
    finish: (exitCode: number) => {
      meta.end = new Date().toISOString();
      meta.exitCode = exitCode;
      writeMeta(dir, meta);
    },
  };
  ACTIVE_RUN = recorder;
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
