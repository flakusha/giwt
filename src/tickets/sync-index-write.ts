// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Canonical index.json persistence (461e906): the target branch stays the
 * single source of truth and index.json is regenerated there post-merge.
 * In a linked worktree the write is skipped — a worktree-local index.json
 * would otherwise be `git add -A`-ed onto the feature branch and conflict
 * at merge time.
 */

import { renameSync, writeFileSync } from "node:fs";
import { log, raw } from "../utils/output";
import { isLinkedWorktree } from "../utils/worktree-probe";

/**
 * Write the sorted index atomically at the main checkout, or skip with an
 * info log inside a linked worktree.
 */
export function persistIndexCanonical(repoRoot: string, indexPath: string, sorted: unknown): void {
  if (isLinkedWorktree(repoRoot)) {
    log(
      "info",
      "index not written in worktree — regenerated post-merge on the target branch",
    );
    return;
  }
  // Atomic write: temp file + rename, so a crash mid-write cannot
  // truncate index.json.
  const tmpPath = `${indexPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(sorted, null, 2) + "\n");
  renameSync(tmpPath, indexPath);
  raw(`Wrote ${indexPath}`);
}
