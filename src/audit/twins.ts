// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Content-twin scan over a directory's tracked blobs — FEAT-detect-
 * resurrected-files check 2.
 *
 * When a rename retires `A` in favour of `B` and a replayed duplicate
 * re-adds `A`, the tree holds two paths with (near-)identical content:
 * byte-identical apart from the migration name in a docblock. Both get
 * discovered, both run, the second `CREATE UNIQUE INDEX` fails at runtime.
 * Nothing objects at commit time — this scan is the objection.
 *
 * Two signals: exact blob-sha groups (byte-identical twins, no content
 * read needed) and pairwise identifier-tolerant comparison via
 * ./normalize for the drifted-docblock case, budgeted by a size-delta
 * prefilter and a comparison cap so huge directories stay cheap.
 */

import { type BlobCache, blobText } from "./git-blobs";
import { compareTwins } from "./normalize";
import type { AuditEvidenceToken, AuditFinding } from "./types";

/** A tracked path with the blob sha it currently points at. */
export interface TrackedBlob {
  sha: string;
  path: string;
}

/** Blobs further apart in size than this are never twins — cheap prefilter
 * that skips cat-file content reads entirely. */
const TWIN_MAX_SIZE_DELTA = 512;

export interface TwinScanOptions {
  repoRoot: string;
  files: readonly TrackedBlob[];
  /** Max blob bytes compared (default 200_000). */
  maxBlobBytes?: number;
  /** Max tolerant comparisons per directory (default 4000) — the walk stays
   * linear-ish even on adversarial same-size directories. */
  maxComparisons?: number;
}

export function scanContentTwins({
  repoRoot,
  files,
  maxBlobBytes = 200_000,
  maxComparisons = 4000,
}: TwinScanOptions): AuditFinding[] {
  const cache: BlobCache = new Map();
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const ctx: TwinPassContext = { repoRoot, maxBlobBytes, cache };
  return [
    ...byteIdenticalTwins(sorted, ctx),
    ...driftedTwins(sorted, ctx, maxComparisons),
  ];
}

/** Shared context for the two twin passes — one cache for the whole scan. */
interface TwinPassContext {
  repoRoot: string;
  maxBlobBytes: number;
  cache: BlobCache;
}

/** Same blob sha under ≥2 paths — but never the empty blob (`.gitkeep`s). */
function byteIdenticalTwins(
  files: readonly TrackedBlob[],
  { repoRoot, maxBlobBytes, cache }: TwinPassContext,
): AuditFinding[] {
  const bySha = new Map<string, TrackedBlob[]>();
  for (const file of files) {
    const group = bySha.get(file.sha) ?? [];
    group.push(file);
    bySha.set(file.sha, group);
  }
  const findings: AuditFinding[] = [];
  for (const [sha, group] of bySha) {
    if (group.length < 2) continue;
    const text = blobText({ repoRoot, sha, maxBytes: maxBlobBytes, cache });
    if (text === null || text.length === 0) continue;
    const paths = group.map((f) => f.path);
    findings.push({
      detector: "resurrected",
      reason: "content-twin",
      severity: "warning",
      rank: 82,
      message:
        `byte-identical content under ${paths.length} paths — a retired twin was probably resurrected`,
      paths,
      evidence: [
        { kind: "sha", detail: `shared blob ${sha}` },
        { kind: "count", detail: `${paths.length} paths` },
      ],
    });
  }
  return findings;
}

/** Pairwise identifier-tolerant comparison of distinct-sha blobs. Sizes
 * read from the (cached) content itself; pairs further apart than the delta
 * are skipped before the twin compare. Findings name both paths and the
 * drifted tokens. */
function driftedTwins(
  files: readonly TrackedBlob[],
  { repoRoot, maxBlobBytes, cache }: TwinPassContext,
  maxComparisons: number,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  let comparisons = 0;
  for (let i = 0; i < files.length && comparisons < maxComparisons; i++) {
    const a = files[i];
    if (a === undefined) break;
    const textA = blobText({ repoRoot, sha: a.sha, maxBytes: maxBlobBytes, cache });
    if (textA === null || textA.length === 0) continue;
    for (let j = i + 1; j < files.length && comparisons < maxComparisons; j++) {
      const b = files[j];
      if (b === undefined) continue;
      comparisons++;
      const textB = blobText({ repoRoot, sha: b.sha, maxBytes: maxBlobBytes, cache });
      if (textB === null || textB.length === 0) continue;
      if (Math.abs(textA.length - textB.length) > TWIN_MAX_SIZE_DELTA) continue;
      const verdict = compareTwins({ textA, pathA: a.path, textB, pathB: b.path });
      if (!verdict.twin || verdict.identical) continue;
      findings.push({
        detector: "resurrected",
        reason: "content-twin",
        severity: "warning",
        rank: 72,
        message: `content twins under two paths — differ only in embedded identifiers`,
        paths: [a.path, b.path],
        evidence: [
          { kind: "sha", detail: `blob ${a.sha}` },
          { kind: "sha", detail: `blob ${b.sha}` },
          ...verdict.differingTokens.map(
            (token): AuditEvidenceToken => ({ kind: "token", detail: token }),
          ),
        ],
      });
    }
  }
  return findings;
}
