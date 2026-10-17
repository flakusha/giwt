// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Backup chain planning: archive naming, `.snar` chain state, and the
 * full-vs-incremental decision for `giwt backup dump`.
 *
 * Layout under the backup root (every write stays inside it):
 *   <root>/<safe-target>.<level>.<UTCts>.tar.zst         archive
 *   <root>/<safe-target>.<level>.<UTCts>.tar.zst.sha256  sidecar
 *   <root>/state/<safe-target>.snar                      chain state
 *
 * File-tree race (documented, accepted): text sources may mutate while a
 * long tar runs; only sqlite sources are quiesced via snapshot, so archives
 * can be internally inconsistent across files. DB files never enter an
 * archive live.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type DumpLevel = "full" | "inc";

export interface BackupArchive {
  /** Safe target name the archive belongs to (see safeTargetName). */
  target: string;
  level: DumpLevel;
  /** UTC stamp as encoded in the name, e.g. 20261017T091500Z. */
  stamp: string;
  /** File name relative to the backup root. */
  archive: string;
  /** sha256 sidecar name (always `<archive>.sha256`). */
  sidecar: string;
}

const ARCHIVE_RE = /^(.+)\.(full|inc)\.(\d{8}T\d{6}Z)\.tar\.zst$/;
const STAMP_RE = /^\d{8}T\d{6}Z$/;

/** Weekly full cadence: a chain older than this re-bases onto a fresh full. */
export const FULL_CADENCE_MS = 7 * 24 * 60 * 60 * 1000;

/** Directory under the backup root holding the per-target .snar files. */
export const STATE_DIR = "state";

/** Path of one target's .snar chain-state file under the backup root. */
export function snarPath(rootAbs: string, safe: string): string {
  return join(rootAbs, STATE_DIR, `${safe}.snar`);
}

/** Youngest FULL archive stamp for a target, or null when it has none. */
export function newestFullMs(archives: BackupArchive[], target: string): number | null {
  let newest: number | null = null;
  for (const archive of archives) {
    if (archive.target !== target || archive.level !== "full") continue;
    const ms = stampMs(archive.stamp);
    if (Number.isFinite(ms) && (newest === null || ms > newest)) newest = ms;
  }
  return newest;
}

/** UTC stamp for a date, tar-name safe: 2026-10-17T09:15:00.000Z → 20261017T091500Z. */
export function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Parse a UTC stamp back to epoch ms; NaN when malformed. */
export function stampMs(stamp: string): number {
  if (STAMP_RE.exec(stamp) === null) return NaN;
  const y = Number(stamp.slice(0, 4));
  const mo = Number(stamp.slice(4, 6));
  const d = Number(stamp.slice(6, 8));
  const h = Number(stamp.slice(9, 11));
  const mi = Number(stamp.slice(11, 13));
  const s = Number(stamp.slice(13, 15));
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/**
 * Filesystem-safe target name for archive/snar file names: path separators
 * and other unsafe runes collapse to `-`; the repo-root target `.` becomes
 * `repo`.
 */
export function safeTargetName(target: string): string {
  const base = target === "." ? "repo" : target;
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "target";
}

/** Parse one archive file name; null for anything else (sidecars, state). */
export function parseArchiveName(name: string): BackupArchive | null {
  const m = ARCHIVE_RE.exec(name);
  if (m === null) return null;
  const target = m[1]!;
  const level = m[2] as DumpLevel;
  const stamp = m[3]!;
  return { target, level, stamp, archive: name, sidecar: `${name}.sha256` };
}

/** Every valid archive currently in the backup root, name-sorted. */
export function listArchives(rootAbs: string): BackupArchive[] {
  let names: string[];
  try {
    names = readdirSync(rootAbs);
  } catch {
    return []; // Root absent — no backups yet is a normal state.
  }
  const found: BackupArchive[] = [];
  for (const name of names) {
    const parsed = parseArchiveName(name);
    if (parsed === null) continue;
    try {
      if (!statSync(join(rootAbs, name)).isFile()) continue;
    } catch {
      continue; // Vanished mid-scan (TOCTOU) — skip, don't fail the listing.
    }
    found.push(parsed);
  }
  return found.sort((a, b) => a.archive.localeCompare(b.archive));
}

/**
 * Weekly-full policy (pure): a fresh full when no chain is open or the
 * youngest full is stale; otherwise the dump rides the open .snar chain as
 * an incremental.
 */
export function planNextLevel(
  { snarExists, youngestFullMs, now }: {
    snarExists: boolean;
    /** Youngest FULL archive stamp for the target, or null when none. */
    youngestFullMs: number | null;
    now: number;
  },
): DumpLevel {
  if (!snarExists) return "full";
  if (youngestFullMs === null) return "full";
  if (now - youngestFullMs >= FULL_CADENCE_MS) return "full";
  return "inc";
}

/**
 * Youngest full+increment chain for a target, in replay order (full first,
 * then incrementals ascending). Empty when the target has no full archive —
 * incrementals before the newest full are unreplayable without it and are
 * excluded.
 */
export function selectChain(archives: BackupArchive[], target: string): BackupArchive[] {
  const own = archives
    .filter((a) => a.target === target)
    .sort((a, b) => stampMs(a.stamp) - stampMs(b.stamp));
  let fullIdx = -1;
  for (let i = own.length - 1; i >= 0; i--) {
    if (own[i]!.level === "full") {
      fullIdx = i;
      break;
    }
  }
  if (fullIdx === -1) return [];
  return own.slice(fullIdx);
}
