// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Blob-content access for the audit detectors — the only place src/audit
 * spawns git for object reads. Spawned directly (not via gitSync) because
 * gitSync trims stdout, and blob content is significant at both ends:
 * trimming would make twin comparison lie. Env is isolated like every
 * other giwt child process so hook-scoped GIT_* context cannot leak in.
 */

import { isolatedGitEnv } from "../utils/git";

/** Shared per-scan blob cache: sha → decoded text (null = unreadable/binary).
 * Passing one Map across a whole scan keeps cat-file spawns at one per
 * distinct blob instead of one per comparison. */
export type BlobCache = Map<string, string | null>;

export interface BlobTextOptions {
  repoRoot: string;
  sha: string;
  /** Blobs over this size are skipped (never fatal) — generated blobs and
   * vendored dumps would drown the signal anyway. */
  maxBytes: number;
  cache: BlobCache;
}

/** Blob text content, or null when missing, binary (NUL byte), oversized,
 * or unreadable. Findings never depend on a blob *not* being readable —
 * callers treat null as "cannot compare". */
export function blobText({ repoRoot, sha, maxBytes, cache }: BlobTextOptions): string | null {
  const cached = cache.get(sha);
  if (cached !== undefined) return cached;
  const proc = Bun.spawnSync(["git", "-C", repoRoot, "cat-file", "blob", sha], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedGitEnv(),
  });
  let text: string | null = null;
  if (proc.exitCode === 0) {
    const bytes = proc.stdout as Buffer;
    if (bytes.byteLength <= maxBytes && !bytes.includes(0)) {
      text = bytes.toString("utf8");
    }
  }
  cache.set(sha, text);
  return text;
}
