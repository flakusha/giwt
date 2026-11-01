// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Interconnect input snapshot: every plan file read exactly once and
 * re-verified before a verdict (TOCTOU guard) — the only fs touch the
 * derivation consumes.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { byStr } from "./resolve";
import type { InterconnectOptions } from "./types";

/** One plan file read exactly once. `text` is the only view the run uses. */
export interface SnapshotFile {
  /** Repo-relative path with forward slashes (also the node path). */
  rel: string;
  abs: string;
  text: string;
}

function listPlanFiles(projectRoot: string, dir: string): SnapshotFile[] {
  const out: SnapshotFile[] = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const abs = join(dir, f);
    const rel = relative(projectRoot, abs).split("\\").join("/");
    out.push({ rel, abs, text: readFileSync(abs, "utf8") });
  }
  return out.sort((a, b) => byStr(a.rel, b.rel));
}

/**
 * Snapshot every input once: `.plan/tickets/*.md`, `.plan/epics/*.md`. The
 * caller derives everything from this array and calls
 * {@link verifySnapshotStable} before writing/reporting, so a concurrent
 * plan writer produces a loud failure instead of partial output.
 */
export function snapshotInterconnectInputs(opts: InterconnectOptions): SnapshotFile[] {
  return [
    ...listPlanFiles(opts.projectRoot, opts.ticketsDir),
    ...listPlanFiles(opts.projectRoot, opts.epicsDir),
  ];
}

/** Re-read every snapshotted file; throw naming the file on divergence. */
export function verifySnapshotStable(snapshot: SnapshotFile[]): void {
  for (const f of snapshot) {
    if (readFileSync(f.abs, "utf8") !== f.text) {
      throw new Error(
        `${f.rel}: changed during interconnect scan — concurrent plan writer; re-run`,
      );
    }
  }
}
