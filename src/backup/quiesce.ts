// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Quiesce rule: never tar a live sqlite database. DB files discovered under
 * a dump target are snapshotted with `sqlite3 .backup` into staging; the
 * live files are excluded from the tar and the snapshots ride along under
 * _giwt-quiesced/<target>/… (mirroring the target-relative layout). A DB
 * the tool cannot snapshot — missing CLI, nonzero exit, no output file — is
 * skipped LOUDLY and excluded entirely: a torn live file never enters an
 * archive.
 */

import { type Dirent, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { log } from "../utils/output";

/** Directory at the archive root holding per-target DB snapshots. */
export const QUIESCE_DIR = "_giwt-quiesced";

const SQLITE_SUFFIXES = [".sqlite", ".sqlite3", ".db"];

/** A discovered live sqlite file: absolute path + path relative to its target. */
export interface SqliteRef {
  abs: string;
  rel: string;
}

export interface QuiesceSkip {
  file: string;
  reason: string;
}

export interface QuiesceOutcome {
  /** Live DB files the tar must exclude, target-relative + absolute. */
  excluded: SqliteRef[];
  /** Snapshot dir to add to the tar, empty string when there is none. */
  snapshotDir: string;
  skipped: QuiesceSkip[];
}

export type SqliteRunner = (args: string[]) => Promise<{
  exitCode: number;
  stderr: string;
}>;

/**
 * Recursive scan for live sqlite files under one target root. Symlinks are
 * skipped (loop + escape safety); an unreadable subtree is left to tar's
 * own error reporting rather than failing the scan.
 */
export function findSqliteFiles(dir: string): SqliteRef[] {
  const found: SqliteRef[] = [];
  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SQLITE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        found.push({ abs, rel: relative(dir, abs) });
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Snapshot every discovered DB under one target into staging. Returns the
 * tar exclusions (always covers every live DB), the snapshot dir to add to
 * the archive (empty when nothing snapshotted), and the loud skips.
 */
export async function quiesceTarget(
  { target, targetAbs, staging, toolAvailable, run }: {
    /** Safe target name (snapshot subdir). */
    target: string;
    targetAbs: string;
    staging: string;
    /** sqlite3 CLI present (Bun.which). */
    toolAvailable: boolean;
    run: SqliteRunner;
  },
): Promise<QuiesceOutcome> {
  const files = findSqliteFiles(targetAbs);
  if (files.length === 0) return { excluded: [], snapshotDir: "", skipped: [] };

  const skipped: QuiesceSkip[] = [];
  if (!toolAvailable) {
    log(
      "warn",
      `backup: ${files.length} sqlite file(s) under ${targetAbs} cannot be snapshotted — sqlite3 CLI not installed; live DB files are EXCLUDED from this archive`,
    );
    return {
      excluded: files,
      snapshotDir: "",
      skipped: files.map((f) => ({
        file: f.abs,
        reason: "sqlite3 CLI not installed — live DB excluded, not snapshotted",
      })),
    };
  }

  const snapshotDir = join(staging, QUIESCE_DIR, target);
  let okCount = 0;
  for (const file of files) {
    const dest = join(snapshotDir, file.rel);
    mkdirSync(dirname(dest), { recursive: true });
    const res = await run(["sqlite3", file.abs, `.backup "${dest}"`]);
    if (res.exitCode !== 0 || !existsSync(dest)) {
      const reason = res.exitCode !== 0
        ? `sqlite3 .backup exited ${res.exitCode}${
          res.stderr.trim().length > 0 ? `: ${res.stderr.trim()}` : ""
        }`
        : "sqlite3 reported success but wrote no snapshot file";
      skipped.push({ file: file.abs, reason });
      log(
        "warn",
        `backup: snapshot failed for ${file.abs} — EXCLUDED from this archive (${reason})`,
      );
      continue;
    }
    okCount++;
  }
  return {
    excluded: files,
    snapshotDir: okCount > 0 ? join(staging, QUIESCE_DIR) : "",
    skipped,
  };
}
