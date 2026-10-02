// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Strict-superset conflict auto-resolution: when the two unmerged stages of
 * a file form a strict superset relationship (every non-empty trimmed line
 * of the smaller side appears in the larger side, in order), the larger side
 * is written and staged. Delete/modify conflicts and overlapping edits stay
 * for manual resolution.
 */

import { log } from "../../utils/output";
import { atomicWrite, fromRoot, runGit, unmergedPaths } from "./git-io";

/** Non-empty trimmed lines of `content`, order preserved. */
function contentLines(content: string): string[] {
  return content.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

/** True when every line of `small` appears in `big` as an ordered subsequence. */
function isOrderedSubsequence(small: string[], big: string[]): boolean {
  let cursor = 0;
  for (const line of big) {
    if (cursor < small.length && line === small[cursor]) cursor++;
  }
  return cursor === small.length;
}

/**
 * Strict-superset test between the two sides of a content conflict: returns
 * the side that contains every line of the other (compared as ordered
 * subsequences of non-empty trimmed lines), or null when the sides are equal
 * (ambiguous which side "wins") or neither contains the other.
 */
export function strictSupersetSide(ours: string, theirs: string): "ours" | "theirs" | null {
  const oursLines = contentLines(ours);
  const theirsLines = contentLines(theirs);
  const oursContainsTheirs = isOrderedSubsequence(theirsLines, oursLines);
  const theirsContainsOurs = isOrderedSubsequence(oursLines, theirsLines);
  if (oursContainsTheirs && theirsContainsOurs) return null;
  if (oursContainsTheirs) return "ours";
  if (theirsContainsOurs) return "theirs";
  return null;
}

/**
 * Auto-resolve unmerged files whose two stages form a strict superset
 * relationship: write the superset side and stage it. Delete/modify conflicts
 * (a missing stage blob) and files neither side contains are left untouched.
 * Returns the resolved paths; each is also announced with a warn log.
 */
export function autoResolveSupersets(root: string): string[] {
  const resolved: string[] = [];
  for (const path of unmergedPaths(root)) {
    const ours = runGit(root, "show", `:2:${path}`);
    const theirs = runGit(root, "show", `:3:${path}`);
    if (ours.exitCode !== 0 || theirs.exitCode !== 0) continue;
    const side = strictSupersetSide(ours.stdout, theirs.stdout);
    if (side === null) continue;
    atomicWrite(fromRoot(root, path), side === "ours" ? ours.stdout : theirs.stdout);
    if (runGit(root, "add", "--", path).exitCode !== 0) continue;
    log("warn", `auto-resolved ${path}: ${side} side is a strict superset`);
    resolved.push(path);
  }
  return resolved;
}
