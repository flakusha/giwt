// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Index-authenticity stamp (FEAT-reject-manual-edits-to-plan-tickets-index).
 *
 * index.json is a derived artifact — ticket .md frontmatter is the source of
 * truth. Every giwt-owned index write (sync's persistIndexCanonical, the
 * rebase generated-conflict merge) records a sidecar fingerprint
 * `.plan/tickets/index.json.stamp` (sha256 of the index bytes). Read/use
 * paths verify the stamp and refuse a MISMATCHED index with the remedy
 * message ("edit the .md and run giwt sync") instead of silently consuming
 * hand-edited data.
 *
 * Failure policy: a MISSING or unreadable stamp fails OPEN — the stamp only
 * exists once a post-feature giwt write has run, so failing closed would
 * brick every pre-existing repo and index-less worktree; adoption is exactly
 * what `giwt sync` does. A PRESENT stamp that does not match the index bytes
 * fails CLOSED: that is precisely the out-of-band-edit signal.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const STAMP_SUFFIX = ".stamp";

/** The clear rejection message every enforcement point raises on a
 * stamp/index mismatch. */
export function manualEditError(indexPath: string): Error {
  return new Error(
    `${indexPath}: manually edited — frontmatter is source of truth; `
      + `edit the .md and run giwt sync`,
  );
}

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** Record the fingerprint of the index bytes just written. Call AFTER every
 * giwt-owned index.json write. */
export function writeIndexStamp(indexPath: string): void {
  writeFileSync(indexPath + STAMP_SUFFIX, `${sha256(readFileSync(indexPath, "utf8"))}\n`);
}

/** Verdict for an index.json on disk:
 *  - "ok": no index (nothing to protect) or stamp present and matching.
 *  - "unstamped": index exists without a readable stamp (fail-open legacy).
 *  - "mismatch": stamp present but the index bytes differ — manual edit. */
export function verifyIndexStamp(indexPath: string): "ok" | "unstamped" | "mismatch" {
  if (!existsSync(indexPath)) return "ok";
  const stampPath = indexPath + STAMP_SUFFIX;
  if (!existsSync(stampPath)) return "unstamped";
  let expected: string;
  try {
    expected = readFileSync(stampPath, "utf8").trim();
  } catch {
    return "unstamped";
  }
  if (!/^[0-9a-f]{64}$/.test(expected)) return "unstamped";
  return sha256(readFileSync(indexPath, "utf8")) === expected ? "ok" : "mismatch";
}

/** Shared guard for read/use paths: throws {@link manualEditError} on a
 * mismatched index. Call after parsing succeeds (a corrupt index keeps its
 * own parse error). */
export function assertIndexUnedited(indexPath: string): void {
  if (verifyIndexStamp(indexPath) === "mismatch") throw manualEditError(indexPath);
}
