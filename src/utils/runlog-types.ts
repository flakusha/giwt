// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Run-record data types and meta writer, split out of runlog.ts for size.
 * Everything here is re-exported from runlog.ts — import from there.
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type WorktreeConfig } from "./config";

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
  /** One-line tmp summary (temp-root bytes freed by `giwt tmp`). */
  tmp?: string | undefined;
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
  /** Milliseconds since the PREVIOUS event of the same run, measured at
   *  write time where the step boundary is already known. Optional by
   *  design: the first event of a run has no predecessor and omits the
   *  field (never 0), and events.jsonl lines written before it existed
   *  still parse. */
  durationMs?: number;
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

export function runsRoot(config: WorktreeConfig): string {
  // repoRoot, NOT worktreeRoot: finalize removes the worktree and must not
  // take its own evidence with it (FIX-run-records-die-with-the-worktree).
  return resolve(config.repoRoot, config.settings.paths.runlog, "runs");
}

export function writeMeta(dir: string, meta: RunMeta): void {
  try {
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  } catch { /* best-effort */ }
}
