// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * jj change-id lookup for the rebase skip ledger. jj rewrites commit ids
 * on every operation; change ids survive. Colocated git plumbing still works
 * for history, but a ledger keyed on a sha goes stale after a rewrite.
 */

import { log } from "../utils/output";

/** Result of one jj CLI invocation. */
export interface JjHistoryResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injectable jj CLI seam; `cmd` always starts with `jj`, never `git`. */
export type JjHistorySpawn = (cmd: string[], cwd: string) => JjHistoryResult;

/** Template: one commit-id ↔ change-id pair per line, unit separator. */
export const CHANGE_ID_TEMPLATE = "commit_id ++ \"\\x1f\" ++ change_id ++ \"\\n\"";

export const defaultJjHistorySpawn: JjHistorySpawn = (cmd, cwd) => {
  try {
    const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  } catch (err) {
    return { stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: 127 };
  }
};

/** Parse `jj log` template output into commit-id → change-id. */
export function parseChangeIds(output: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    const [sha, change] = line.trim().split("\x1f");
    if (sha !== undefined && sha !== "" && change !== undefined && change !== "") {
      map.set(sha, change);
    }
  }
  return map;
}

/** Current commit-id → change-id map; `shas` also resolves hidden commits. */
export function jjChangeIds({
  root,
  shas,
  spawn = defaultJjHistorySpawn,
}: {
  root: string;
  /** Commit ids to mention explicitly — `all()` alone hides rewritten commits. */
  shas?: readonly string[];
  spawn?: JjHistorySpawn;
}): ReadonlyMap<string, string> {
  const revset = shas === undefined || shas.length === 0
    ? "all()"
    : `all() | ${shas.map((sha) => `commit_id(${sha})`).join(" | ")}`;
  const result = spawn(["jj", "log", "-r", revset, "--no-graph", "-T", CHANGE_ID_TEMPLATE], root);
  if (result.exitCode !== 0) {
    throw new Error(`jj log (change ids) failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return parseChangeIds(result.stdout);
}

/** Change-id map, or undefined (with a loud warning) when jj is unavailable. */
export function tryJjChangeIds({
  root,
  shas,
  spawn,
}: {
  root: string;
  shas?: readonly string[];
  spawn?: JjHistorySpawn;
}): ReadonlyMap<string, string> | undefined {
  try {
    return jjChangeIds({
      root,
      ...(shas !== undefined ? { shas } : {}),
      ...(spawn !== undefined ? { spawn } : {}),
    });
  } catch (err) {
    log("warn", `jj change-id lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
