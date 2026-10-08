// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Resurrected-file scan — FEAT-detect-resurrected-files.
 *
 * A rename commit retires `A` in favour of `B`; a later replayed duplicate
 * re-adds `A`; the tree now holds two paths with the same content and
 * nothing objects at commit time. In numbered-migration directories the
 * failure is catastrophic and silent until runtime.
 *
 * Two checks over a directory's tracked files (git ls-files, so committed
 * state is what gets audited):
 *   1. number collisions — two files claiming the same leading integer is
 *      a defect REGARDLESS of content (the ordering contract is broken);
 *   2. content twins — via ./twins: byte-identical blobs under two paths,
 *      or blobs differing only in an embedded identifier.
 *
 * Pure library: structured findings only, no output, no mutation.
 */

import { basename, posix } from "node:path";
import { gitSync } from "../utils/git";
import { scanContentTwins, type TrackedBlob } from "./twins";
import type { AuditFinding } from "./types";

const LEADING_NUMBER_RE = /^(\d+)/;

/** One `100644 <sha> <stage> TAB <path>` line from ls-files -s. */
const LS_FILES_LINE_RE = /^\d+ ([0-9a-f]+) \d+\t(.+)$/;

export interface ResurrectedScanOptions {
  repoRoot: string;
  /** Repo-relative directories to scan (tracked files only, recursive). */
  dirs: readonly string[];
  /** Max tracked files per directory (default 500) — bounded walk. */
  maxFilesPerDir?: number;
  /** Max blob bytes compared for twins (default 200_000). */
  maxBlobBytes?: number;
}

/** Tracked files under one directory, filename-ordered, as blob records. */
export function trackedBlobsUnder({
  repoRoot,
  dir,
  maxFiles,
}: {
  repoRoot: string;
  dir: string;
  maxFiles: number;
}): TrackedBlob[] {
  const out = gitSync(repoRoot, "ls-files", "--full-name", "-s", "--", dir);
  const blobs: TrackedBlob[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const match = LS_FILES_LINE_RE.exec(line);
    if (match === null) {
      throw new Error(`audit resurrected: unparseable ls-files line: ${line}`);
    }
    blobs.push({ sha: match[1] ?? "", path: match[2] ?? "" });
  }
  return blobs
    .sort((a, b) => posix.basename(a.path).localeCompare(posix.basename(b.path)))
    .slice(0, maxFiles);
}

/** Group files by the leading integer of their basename (`040_x` → 40);
 * any group of two or more is a defect regardless of content. */
export function numberCollisionFindings({
  files,
  dir,
}: {
  files: readonly TrackedBlob[];
  dir: string;
}): AuditFinding[] {
  const byNumber = new Map<number, string[]>();
  for (const file of files) {
    const match = LEADING_NUMBER_RE.exec(basename(file.path));
    if (match === null) continue;
    const num = Number(match[1]);
    const paths = byNumber.get(num) ?? [];
    paths.push(file.path);
    byNumber.set(num, paths);
  }
  const findings: AuditFinding[] = [];
  for (const [num, paths] of byNumber) {
    if (paths.length < 2) continue;
    findings.push({
      detector: "resurrected",
      reason: "number-collision",
      severity: "critical",
      rank: 90,
      message:
        `${paths.length} tracked files claim leading number ${num} under ${dir}/ — the ordering contract is broken`,
      paths: [...paths].sort(),
      evidence: [
        { kind: "token", detail: `leading number ${num}` },
        { kind: "count", detail: `${paths.length} files` },
      ],
    });
  }
  return findings;
}

/**
 * Scan every configured directory for duplicate leading numbers and content
 * twins. Findings are returned rank-descending; unreadable state throws
 * (same contract as gitSync) — the scan never silently under-reports.
 */
export function scanResurrectedFiles({
  repoRoot,
  dirs,
  maxFilesPerDir = 500,
  maxBlobBytes = 200_000,
}: ResurrectedScanOptions): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const dir of dirs) {
    const files = trackedBlobsUnder({ repoRoot, dir, maxFiles: maxFilesPerDir });
    findings.push(
      ...numberCollisionFindings({ files, dir }),
      ...scanContentTwins({ repoRoot, files, maxBlobBytes }),
    );
  }
  return findings.sort((a, b) => b.rank - a.rank);
}
