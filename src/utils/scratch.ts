// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared scratchpad scanner — the single source of truth for artifact
 * classification under `<worktreeRoot>/<settings.scratch.root>` (default
 * `.tmp`). Consumed by `giwt clean` today and the planned `doctor
 * scratchpad` check tomorrow; no duplicate scanning logic may live anywhere
 * else (ticket TASK-giwt-clean-age-size-capped-tmp-pruning).
 *
 * Classes, verified against a real `.tmp` inventory (cov-dev/, cov-strict/,
 * cov-test/, cov-unit-only/, cov-verify/, coverage-* dirs, jscpd/,
 * jscpd-report.json, check-report*.json, *.log, *.txt, run-* dirs):
 *
 *   tmp           every `*.tmp` FILE anywhere under root older than
 *                 tmpMaxAgeDays, except files inside `cov-*` directories
 *                 (those belong to lcov) and lcov-shaped `*.tmp` files
 *                 (also lcov's — keeps classes disjoint so --apply never
 *                 deletes the same path twice and freed bytes never
 *                 double-count)
 *   lcov          every `lcov.*.tmp` FILE anywhere under root (age-
 *                 independent) PLUS `cov-*` DIRECTORIES sorted by mtime
 *                 desc keeping the newest lcovKeepLatest; older cov-* dirs
 *                 become candidates (dir bytes = recursive sum, mtime = the
 *                 directory's own)
 *   jscpd         `jscpd-report.json` at root level or directly inside a
 *                 root-level `jscpd*` directory (one level deep), if older
 *                 than jscpdMaxAgeDays
 *   check-report  root-level `check-report*.json` sorted mtime desc, newest
 *                 checkReportKeep kept, remainder candidates
 *
 * Safety contract: pure and synchronous (node:fs only, no process.exit, no
 * console), never follows symlinks (lstat; symlink entries are skipped
 * entirely), never touches anything outside `root`, and a missing root
 * yields a zero scan instead of a throw. No candidate is nested inside
 * another candidate, so an apply pass can delete class-by-class without
 * ENOENT surprises.
 */

import { lstatSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScratchEntry {
  path: string;
  bytes: number;
  mtimeMs: number;
}

export interface ScratchClass {
  name: "tmp" | "lcov" | "jscpd" | "check-report";
  /** What an apply pass deletes. */
  candidates: ScratchEntry[];
  /** What stays. */
  keep: ScratchEntry[];
}

export interface ScratchScan {
  root: string;
  classes: ScratchClass[];
  totalCandidateBytes: number;
  totalCandidateCount: number;
  /** Everything under root, candidates or not. */
  totalBytes: number;
  /** Oldest mtime of anything under root, or null when missing/empty. */
  oldestMtimeMs: number | null;
}

export interface ScratchConfig {
  tmpMaxAgeDays: number;
  lcovKeepLatest: number;
  jscpdMaxAgeDays: number;
  checkReportKeep: number;
}

/** Config `giwt clean` and the doctor scratchpad check fall back to when
 *  settings carry no [scratch] overrides — DEFAULT_SETTINGS spreads this so
 *  the two can never drift. */
export const DEFAULT_SCRATCH_CONFIG: ScratchConfig = {
  tmpMaxAgeDays: 7,
  lcovKeepLatest: 2,
  jscpdMaxAgeDays: 7,
  checkReportKeep: 20,
};

/** Doctor scratchpad severity thresholds (sizes in MB, orphan count, age in
 *  days). DEFAULT_SETTINGS imports these for the [doctor] keys. */
export interface ScratchpadThresholds {
  warnMb: number;
  errorMb: number;
  orphanWarn: number;
  oldestWarnDays: number;
}

export const DEFAULT_SCRATCHPAD_THRESHOLDS: ScratchpadThresholds = {
  warnMb: 100,
  errorMb: 500,
  orphanWarn: 100,
  oldestWarnDays: 30,
};

/** lcov temp spill: `lcov.<anything>.tmp`, including the leading-dot
 *  variant (`.lcov.info.<hash>.tmp`) that coverage runs drop inside cov-*
 *  directories. */
function isLcovTmp(name: string): boolean {
  return /^\.?lcov\..+\.tmp$/.test(name);
}

/** True when childRel lives inside dirRel — everything under a candidate
 *  directory is already accounted for by that directory's recursive byte
 *  sum, so a nested entry must not be counted (or deleted) a second time.
 *  The `+ sep` guard is what keeps `cov-a` from matching `cov-ab`. */
function isInside(childRel: string, dirRel: string): boolean {
  return childRel.startsWith(dirRel + sep);
}

interface WalkNode {
  /** Path relative to root; root itself is never a node. */
  rel: string;
  name: string;
  isDir: boolean;
  /** Recursive byte sum for dirs, file size for files. */
  bytes: number;
  mtimeMs: number;
}

/** Depth-first walk collecting every non-symlink entry with recursive byte
 *  sums; returns the total bytes under absDir. Unreadable/missing entries
 *  are skipped, never thrown. A reduce-style min here (instead of
 *  Math.min(...spread)) keeps large scratchpads off the call stack. */
function walk(absDir: string, rel: string, out: WalkNode[]): number {
  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch {
    return 0;
  }
  let bytes = 0;
  for (const name of names) {
    const abs = join(absDir, name);
    const childRel = rel === "" ? name : rel + sep + name;
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue; // raced away or unreadable — skip, never throw
    }
    if (st.isSymbolicLink()) continue; // never follow, never count
    if (st.isDirectory()) {
      const sub = walk(abs, childRel, out);
      bytes += sub;
      out.push({ rel: childRel, name, isDir: true, bytes: sub, mtimeMs: st.mtimeMs });
    } else if (st.isFile()) {
      bytes += st.size;
      out.push({ rel: childRel, name, isDir: false, bytes: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return bytes;
}

function oldestOf(nodes: WalkNode[]): number | null {
  let oldest: number | null = null;
  for (const n of nodes) {
    if (oldest === null || n.mtimeMs < oldest) oldest = n.mtimeMs;
  }
  return oldest;
}

/** Newest first; ties broken by path so plans stay deterministic across
 *  runs. Shared by every class so plan ordering is uniform. */
function byNewest(a: ScratchEntry, b: ScratchEntry): number {
  return b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path);
}

export function scanScratch(
  root: string,
  cfg: ScratchConfig,
  nowMs: number = Date.now(),
): ScratchScan {
  const nodes: WalkNode[] = [];
  const totalBytes = walk(root, "", nodes);
  const oldestMtimeMs = oldestOf(nodes);

  const toEntry = (n: WalkNode): ScratchEntry => ({
    path: join(root, n.rel),
    bytes: n.bytes,
    mtimeMs: n.mtimeMs,
  });

  // --- lcov: cov-* directories (any depth) split into keep/candidates ---
  const covDirs = nodes.filter((n) => n.isDir && n.name.startsWith("cov-"));
  const sortedCov = [...covDirs].sort((a, b) =>
    b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel)
  );
  const keepN = Math.max(0, cfg.lcovKeepLatest);
  const keptCov = sortedCov.slice(0, keepN);
  const oldCov = sortedCov.slice(keepN);

  const lcovFiles = nodes.filter((n) => !n.isDir && isLcovTmp(n.name));
  // Files under an already-candidate cov dir ride the dir's byte sum.
  const lcovCandidates = lcovFiles.filter((n) => !oldCov.some((d) => isInside(n.rel, d.rel)));

  // --- tmp: aged *.tmp files outside cov-* dirs, lcov-shaped excluded ---
  const tmpCutoff = nowMs - cfg.tmpMaxAgeDays * DAY_MS;
  const tmpMembers = nodes.filter((n) =>
    !n.isDir && n.name.endsWith(".tmp") && !isLcovTmp(n.name)
    && !covDirs.some((d) => isInside(n.rel, d.rel))
  );
  const tmpCandidates = tmpMembers.filter((n) => n.mtimeMs < tmpCutoff);
  const tmpKeep = tmpMembers.filter((n) => n.mtimeMs >= tmpCutoff);

  // --- jscpd: jscpd-report.json at root level or directly inside a
  // root-level jscpd* dir (one level deep), behind an age gate. Deeper
  // nesting does not match — those are deliberate archives, not spills. ---
  const jscpdReports = nodes.filter((n) => {
    if (n.isDir || n.name !== "jscpd-report.json") return false;
    const segs = n.rel.split(sep);
    if (segs.length === 1) return true;
    return segs.length === 2 && segs[0]!.startsWith("jscpd");
  });
  const jscpdCutoff = nowMs - cfg.jscpdMaxAgeDays * DAY_MS;
  const jscpdCandidates = jscpdReports
    .filter((n) => n.mtimeMs < jscpdCutoff)
    .map(toEntry)
    .sort(byNewest);
  const jscpdKeep = jscpdReports
    .filter((n) => n.mtimeMs >= jscpdCutoff)
    .map(toEntry)
    .sort(byNewest);

  // --- check-report: root-level check-report*.json behind a count cap ---
  const reports = nodes
    .filter((n) => !n.isDir && !n.rel.includes(sep) && /^check-report.*\.json$/.test(n.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel));
  const reportKeepN = Math.max(0, cfg.checkReportKeep);
  const reportKeep = reports.slice(0, reportKeepN);
  const reportCandidates = reports.slice(reportKeepN);

  const classes: ScratchClass[] = [
    {
      name: "tmp",
      candidates: tmpCandidates.map(toEntry).sort(byNewest),
      keep: tmpKeep.map(toEntry).sort(byNewest),
    },
    {
      name: "lcov",
      candidates: [...lcovCandidates, ...oldCov].map(toEntry).sort(byNewest),
      keep: keptCov.map(toEntry).sort(byNewest),
    },
    {
      name: "jscpd",
      candidates: jscpdCandidates,
      keep: jscpdKeep,
    },
    {
      name: "check-report",
      candidates: reportCandidates.map(toEntry),
      keep: reportKeep.map(toEntry),
    },
  ];

  let totalCandidateBytes = 0;
  let totalCandidateCount = 0;
  for (const cls of classes) {
    for (const e of cls.candidates) {
      totalCandidateBytes += e.bytes;
      totalCandidateCount++;
    }
  }

  return { root, classes, totalCandidateBytes, totalCandidateCount, totalBytes, oldestMtimeMs };
}

/** The n largest DIRECT child directories of root by recursive byte sum,
 *  reusing the same walker as scanScratch (lstat, symlinks skipped, errors
 *  swallowed). Ties break by path so ordering is deterministic; a missing
 *  or unreadable root yields []. Sizes are recursive sums, so a big child
 *  never hides its parent — but parents are not listed, only direct
 *  children of root. */
export function largestDirs(
  root: string,
  n: number,
): Array<{ path: string; bytes: number; }> {
  const nodes: WalkNode[] = [];
  walk(root, "", nodes);
  const cap = Math.max(0, Math.floor(n));
  return nodes
    .filter((x) => x.isDir && !x.rel.includes(sep))
    .sort((a, b) => b.bytes - a.bytes || a.rel.localeCompare(b.rel))
    .slice(0, cap)
    .map((d) => ({ path: join(root, d.rel), bytes: d.bytes }));
}
