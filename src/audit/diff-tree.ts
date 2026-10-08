// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * diff-tree output parsing — the path-free normalization primitive behind
 * the rename-insensitive fingerprint. `git diff-tree -r --no-renames` emits
 * one `:omode nmode oblob nblob status\tpath` line per changed file; with
 * renames disabled, a rename becomes an A+D pair, so nothing about the PATH
 * survives into a fingerprint. Unparseable or unexpected status lines throw
 * — the detector must never silently under-read a commit.
 */

/** Change kinds we fingerprint. `T` (typechange) counts as a modification. */
export type ChangeKind = "A" | "M" | "D";

const STATUS_TO_KIND: Record<string, ChangeKind> = { A: "A", D: "D", M: "M", T: "M" };

export interface FingerprintEntry {
  /** Post-image blob for A/M; the deleted blob for D. */
  blob: string;
  kind: ChangeKind;
  path: string;
}

/** One `:omode nmode oblob nblob status\tpath` line from diff-tree. */
const DIFF_TREE_LINE_RE = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*\t(.+)$/;

export function parseDiffTree(out: string): FingerprintEntry[] {
  const entries: FingerprintEntry[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const match = DIFF_TREE_LINE_RE.exec(line);
    if (match === null) {
      throw new Error(`audit fingerprint: unparseable diff-tree line: ${line}`);
    }
    const kind = STATUS_TO_KIND[match[3] ?? ""];
    if (kind === undefined) {
      throw new Error(`audit fingerprint: unsupported diff status in line: ${line}`);
    }
    entries.push({
      blob: (kind === "D" ? match[1] : match[2]) ?? "",
      kind,
      path: match[4] ?? "",
    });
  }
  return entries;
}
