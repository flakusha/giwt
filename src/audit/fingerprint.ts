// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Rename-insensitive commit fingerprint — the BUG-patch-id fix direction.
 *
 * Stable patch-id dedup is content-addressed on the diff, and a rename is
 * itself a diff: when a rename sits between two copies of the same change
 * (loop-lore: `c809ab5` adds `040_messages_idempotency_unique.ts`,
 * `17ea74` renames it to `045_…` R097, `35f29d` replays the identical
 * diff), the replayed twin stops matching anything already applied, so git
 * re-applies it and resurrects the retired file.
 *
 * Normalization: a commit is the multiset of (post-image blob sha,
 * change-kind) pairs from `git diff-tree -r --no-renames` — path names are
 * ignored by construction, so a rename between two copies cannot defeat
 * the match. Exact multiset equality is the strong signal; a tolerant pass
 * additionally accepts identifier-only drift (the R097 docblock name) via
 * ./normalize. Known limit, by design: modifications whose pre-images
 * diverged share a patch-id but not post-image blobs, and are not matched.
 *
 * The detector only ever REPORTS — dropping or skipping a replayed commit
 * stays the caller's decision.
 */

import { gitSync } from "../utils/git";
import { type FingerprintEntry, parseDiffTree } from "./diff-tree";
import { type BlobCache, blobText } from "./git-blobs";
import { compareTwins } from "./normalize";
import type {
  AuditEvidence,
  AuditEvidenceSha,
  AuditEvidenceToken,
  AuditFinding,
  AuditSeverity,
} from "./types";

export interface CommitFingerprint {
  sha: string;
  entries: FingerprintEntry[];
}

/**
 * Fingerprint one commit. Merge commits yield an empty fingerprint (they
 * have no single-parent diff to normalize) and simply never match.
 */
export function commitFingerprint({
  repoRoot,
  revision,
}: {
  repoRoot: string;
  revision: string;
}): CommitFingerprint {
  const sha = gitSync(repoRoot, "rev-parse", "--verify", "--quiet", `${revision}^{commit}`);
  const out = gitSync(
    repoRoot,
    "diff-tree",
    "-r",
    "--no-renames",
    "--no-commit-id",
    "--root",
    sha,
  );
  return { sha, entries: parseDiffTree(out) };
}

/** Multiset key: sorted `kind:blob` pairs — path-free by construction. */
function multisetKey(entries: readonly FingerprintEntry[]): string {
  return entries.map((e) => `${e.kind}:${e.blob}`).sort().join("\n");
}

function kindCounts(entries: readonly FingerprintEntry[]): string {
  return entries.map((e) => e.kind).sort().join("");
}

export interface FingerprintMatch {
  candidate: string;
  target: string;
  /** true: identical (blob, kind) multisets. false: identifier-tolerant. */
  exact: boolean;
  /** Exact: the shared blobs. Tolerant: `candSha=targetSha` pair strings. */
  sharedBlobs: string[];
  /** Identifier-only differences, as `candidateValue → targetValue`. */
  differingTokens: string[];
}

export interface DuplicateScanOptions {
  repoRoot: string;
  /** Candidate commit to test (any revision spec). */
  candidate: string;
  /** Target ref or range to search, e.g. `master` or `master~20..master`. */
  target: string;
  /** Max target commits examined (default 2000) — bounds the walk. */
  maxCommits?: number;
  /** Max blob bytes for tolerant comparison (default 200_000). */
  maxBlobBytes?: number;
}

/**
 * Find commits in `target` whose rename-normalized fingerprint matches the
 * candidate. Pure query: reports matches with evidence, never suggests
 * dropping the candidate.
 */
export function findAppliedDuplicates({
  repoRoot,
  candidate,
  target,
  maxCommits = 2000,
  maxBlobBytes = 200_000,
}: DuplicateScanOptions): FingerprintMatch[] {
  const candidateFp = commitFingerprint({ repoRoot, revision: candidate });
  if (candidateFp.entries.length === 0) return [];
  const targetShas = gitSync(repoRoot, "rev-list", "--no-merges", target)
    .split("\n")
    .filter((sha) => sha !== "")
    .slice(0, maxCommits);
  const cache: BlobCache = new Map();
  const matches: FingerprintMatch[] = [];
  for (const targetSha of targetShas) {
    if (targetSha === candidateFp.sha) continue;
    const targetFp = commitFingerprint({ repoRoot, revision: targetSha });
    if (
      targetFp.entries.length !== candidateFp.entries.length
      || kindCounts(targetFp.entries) !== kindCounts(candidateFp.entries)
    ) {
      continue;
    }
    if (multisetKey(targetFp.entries) === multisetKey(candidateFp.entries)) {
      matches.push({
        candidate: candidateFp.sha,
        target: targetSha,
        exact: true,
        sharedBlobs: [...new Set(candidateFp.entries.map((e) => e.blob))],
        differingTokens: [],
      });
      continue;
    }
    const tolerant = tolerantMatch({ candidateFp, targetFp, cache, repoRoot, maxBlobBytes });
    if (tolerant !== null) matches.push(tolerant);
  }
  return matches;
}

/** Pair entries per change kind in sorted-path order (identical paths pair
 * naturally; renamed paths pair deterministically) and require EVERY pair to
 * be identifier-only twins. Any real content difference breaks the match —
 * this is the anti-false-positive spine. */
interface TolerantMatchOptions {
  candidateFp: CommitFingerprint;
  targetFp: CommitFingerprint;
  cache: BlobCache;
  repoRoot: string;
  maxBlobBytes: number;
}

function tolerantMatch({
  candidateFp,
  targetFp,
  cache,
  repoRoot,
  maxBlobBytes,
}: TolerantMatchOptions): FingerprintMatch | null {
  const sharedBlobs: string[] = [];
  const differingTokens: string[] = [];
  for (const kind of ["A", "M", "D"] as const) {
    const candSide = candidateFp.entries.filter((e) => e.kind === kind)
      .sort((a, b) => a.path.localeCompare(b.path));
    const tgtSide = targetFp.entries.filter((e) => e.kind === kind)
      .sort((a, b) => a.path.localeCompare(b.path));
    for (let i = 0; i < candSide.length; i++) {
      const cand = candSide[i];
      const tgt = tgtSide[i];
      if (cand === undefined || tgt === undefined) return null;
      const textA = blobText({ repoRoot, sha: cand.blob, maxBytes: maxBlobBytes, cache });
      const textB = blobText({ repoRoot, sha: tgt.blob, maxBytes: maxBlobBytes, cache });
      if (textA === null || textB === null) return null;
      const verdict = compareTwins({
        textA,
        pathA: cand.path,
        textB,
        pathB: tgt.path,
      });
      if (!verdict.twin) return null;
      sharedBlobs.push(`${cand.blob}=${tgt.blob}`);
      for (const token of verdict.differingTokens) {
        if (!differingTokens.includes(token)) differingTokens.push(token);
      }
    }
  }
  return {
    candidate: candidateFp.sha,
    target: targetFp.sha,
    exact: false,
    sharedBlobs,
    differingTokens,
  };
}

/**
 * Convert a match into the shared AuditFinding shape for the umbrella
 * reporter: reason `duplicate-commit`, severity critical (a silent re-add
 * is blast-radius damage), evidence carrying both shas, the shared/normalized
 * blobs and the drifted tokens.
 */
export function duplicateCommitFinding(match: FingerprintMatch): AuditFinding {
  const severity: AuditSeverity = "critical";
  const evidence: AuditEvidence[] = [
    { kind: "sha", detail: `candidate ${match.candidate}` },
    { kind: "sha", detail: `target ${match.target}` },
    ...match.sharedBlobs.map((blob): AuditEvidenceSha => ({
      kind: "sha",
      detail: match.exact ? `shared blob ${blob}` : `normalized-equal blobs ${blob}`,
    })),
    ...match.differingTokens.map((token): AuditEvidenceToken => ({ kind: "token", detail: token })),
  ];
  return {
    detector: "fingerprint",
    reason: "duplicate-commit",
    severity,
    rank: match.exact ? 95 : 80,
    message: `commit ${match.candidate.slice(0, 9)} duplicates ${match.target.slice(0, 9)} `
      + `by rename-insensitive fingerprint (${
        match.exact ? "exact blob multiset" : "identifier-tolerant"
      })`,
    paths: [],
    evidence,
  };
}
