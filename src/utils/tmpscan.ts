// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared /tmp analyzer + gated cleanup scanner — the single source of truth
 * for `giwt tmp` (and any doctor tmp check that lands later).
 *
 * Why a dedicated scanner: /tmp on this workstation is a RAM-backed device
 * (zram), so stale test fixtures burn real memory. But /tmp is shared by
 * every process on the machine, so the cleanup side is gated hard:
 *
 *  1. ROOT GATE   — only a fixed allowlist of temp roots is ever touched
 *                   (/tmp, $TMPDIR, os.tmpdir()); anything under /home,
 *                   /etc, /usr, /var, /boot, /root, /proc, /sys, /dev,
 *                   /run — or an unrecognized path — hard-refuses before
 *                   any scan or delete. See validateTmpRoot().
 *  2. NAME GATE   — a top-level entry is a candidate only when its name
 *                   matches the `[tmp] prefixes` allowlist (giwt/loop-lore
 *                   test-fixture prefixes by default). Unknown names are
 *                   reported, never deleted.
 *  3. OWNER GATE  — only entries owned by the current euid are candidates;
 *                   root's and other users' files are reported, never
 *                   touched.
 *  4. TYPE GATE   — symlinks, sockets, FIFOs and devices are never
 *                   candidates (lstat-classified; the walker never follows
 *                   symlinks).
 *  5. AGE GATE    — entries younger than `[tmp] max_age_hours` are skipped;
 *                   a live test run's fixtures are not cleaned mid-flight.
 *  6. DELETE-TIME — the applier re-lstats and re-realpaths every candidate
 *     REVALIDATION  immediately before rm, so a scan→apply race or a
 *                   renamed/replaced entry cannot widen the blast radius.
 */

import { lstatSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import { join, sep } from "node:path";
import { mountInfoFor, statfsNumbers } from "./tmpscan-root";

export { validateTmpRoot } from "./tmpscan-root";

const HOUR_MS = 60 * 60 * 1000;

export interface TmpEntry {
  /** File name inside the tmp root (never the full path). */
  name: string;
  /** Full path inside the tmp root. */
  path: string;
  /** Recursive byte sum (directories) or file size. */
  bytes: number;
  /** mtime age in ms at scan time. */
  ageMs: number;
  kind: "dir" | "file";
}

export interface TmpSkip {
  name: string;
  reason: "prefix" | "owner" | "type" | "age" | "unreadable";
}

export interface TmpScan {
  /** Validated scan root. */
  root: string;
  /** Total bytes under root. */
  rootBytes: number;
  /** statfs numbers, null when unavailable. */
  freeBytes: number | null;
  totalBytes: number | null;
  /** Filesystem type of the mount carrying root ("ext4", "tmpfs", …), null when unknown. */
  fsType: string | null;
  /** True when the mount is RAM-backed (tmpfs/ramfs or a /dev/zram* source). */
  ramBacked: boolean;
  entries: TmpEntry[];
  candidates: TmpEntry[];
  skips: TmpSkip[];
  candidateBytes: number;
}

export interface TmpScanOptions {
  prefixes: string[];
  maxAgeHours: number;
}

/** Defaults when settings carry no [tmp] overrides. */
export const DEFAULT_TMP_OPTIONS: TmpScanOptions = {
  prefixes: ["giwt-", "sync-ticket-", "loop-lore-"],
  maxAgeHours: 6,
};

interface WalkNode {
  bytes: number;
  mtimeMs: number;
}

/** Depth-first byte sum with symlink refusal: a symlink contributes its
 *  lstat size, never its target's contents. Unreadable entries count 0
 *  and are never thrown. */
function walkBytes(abs: string, st: Stats): WalkNode {
  if (!st.isDirectory()) return { bytes: st.size, mtimeMs: st.mtimeMs };
  let bytes = 0;
  let mtimeMs = st.mtimeMs;
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch {
    return { bytes: 0, mtimeMs };
  }
  for (const name of names) {
    const child = join(abs, name);
    let cst: Stats;
    try {
      cst = lstatSync(child);
    } catch {
      continue;
    }
    if (cst.isSymbolicLink()) {
      bytes += cst.size;
      continue;
    }
    const sub = walkBytes(child, cst);
    bytes += sub.bytes;
    if (sub.mtimeMs > mtimeMs) mtimeMs = sub.mtimeMs;
  }
  return { bytes, mtimeMs };
}

/** Scan root (already validated) and split top-level entries into
 *  candidates and skips per the gates in the module doc. Unreadable
 *  roots report totals only, never throw. */
export function scanTmp(
  root: string,
  opts: TmpScanOptions,
  nowMs: number = Date.now(),
): TmpScan {
  const st = statSync(root);
  const { fsType, ramBacked } = mountInfoFor(root);
  const { freeBytes, totalBytes } = statfsNumbers(root);
  const scan: TmpScan = {
    root,
    rootBytes: walkBytes(root, st).bytes,
    freeBytes,
    totalBytes,
    fsType,
    ramBacked,
    entries: [],
    candidates: [],
    skips: [],
    candidateBytes: 0,
  };
  const uid = process.getuid?.() ?? -1;
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return scan;
  }
  for (const name of names) {
    const path = join(root, name);
    let lst: Stats;
    try {
      lst = lstatSync(path);
    } catch {
      scan.skips.push({ name, reason: "unreadable" });
      continue;
    }
    const kind = lst.isDirectory() ? "dir" : lst.isFile() ? "file" : null;
    if (kind === null) {
      scan.skips.push({ name, reason: "type" });
      continue;
    }
    const info = walkBytes(path, lst);
    const entry: TmpEntry = {
      name,
      path,
      bytes: info.bytes,
      ageMs: Math.max(0, nowMs - info.mtimeMs),
      kind,
    };
    scan.entries.push(entry);
    if (!opts.prefixes.some((p) => name.startsWith(p))) {
      scan.skips.push({ name, reason: "prefix" });
      continue;
    }
    if (uid >= 0 && lst.uid !== uid) {
      scan.skips.push({ name, reason: "owner" });
      continue;
    }
    if (entry.ageMs < opts.maxAgeHours * HOUR_MS) {
      scan.skips.push({ name, reason: "age" });
      continue;
    }
    scan.candidates.push(entry);
    scan.candidateBytes += entry.bytes;
  }
  // Deterministic plans across runs.
  scan.entries.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  scan.candidates.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return scan;
}

export interface TmpDeleteFailure {
  path: string;
  error: string;
}

/** Delete one candidate with delete-time revalidation: the entry must
 *  still exist, still resolve under root, still be a plain dir/file, and
 *  still be owned by euid. Throws on any gate failure — the caller
 *  collects per-entry and keeps going. */
export function deleteTmpCandidate(entry: TmpEntry, root: string): void {
  const realRoot = realpathSync(root);
  const real = realpathSync(entry.path);
  if (!real.startsWith(realRoot + sep)) {
    throw new Error(`revalidated outside ${root} (resolved to ${real})`);
  }
  const st = lstatSync(entry.path);
  if (st.isSymbolicLink() || !(st.isDirectory() || st.isFile())) {
    throw new Error("revalidation failed: not a plain dir/file anymore");
  }
  const uid = process.getuid?.() ?? -1;
  if (uid >= 0 && st.uid !== uid) {
    throw new Error("revalidation failed: owner changed");
  }
  rmSync(entry.path, { recursive: true, force: false });
}
