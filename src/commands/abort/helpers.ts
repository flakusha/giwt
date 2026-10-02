// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure recovery helpers for `giwt abort`: lockfile scan/remove, stash list
 * parsing/selection, and in-progress-operation sentinels. All take an
 * injectable file-system so tests drive them without touching real repo
 * state; the `abort` orchestrator re-exports the public surface.
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "path";

export const LOCK_FILENAME = ".worktree-finalize.lock";
export const FINALIZE_STASH_PREFIX = "worktree-finalize-";
// Sentinel files git drops into .git/ during in-progress operations. We
// abort each one we find. Order matters: abort merge before pop stash, so
// a stash entry created for a merge doesn't get pulled onto a conflicted
// tree.
export const DEV_IN_PROGRESS_HEADS = ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD"] as const;

/**
 * git subcommand that aborts the operation behind a `<OP>_HEAD` sentinel.
 * Derived via a table, not `name.replace("_HEAD", "").toLowerCase()` — that
 * produced `cherry_pick`, a command git does not have.
 */
export const IN_PROGRESS_ABORT_COMMAND: Record<(typeof DEV_IN_PROGRESS_HEADS)[number], string> = {
  MERGE_HEAD: "merge",
  REBASE_HEAD: "rebase",
  CHERRY_PICK_HEAD: "cherry-pick",
};

/**
 * Minimal fs surface for the pure helpers. Production code uses the
 * default `{ existsSync, readFileSync, unlinkSync }` from `node:fs`; tests
 * can pass an in-memory map-backed implementation to avoid touching the
 * real filesystem.
 */
export interface FsOps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
  unlinkSync: (path: string) => void;
}

const defaultFs: FsOps = { existsSync, readFileSync, unlinkSync };

/**
 * True when `REBASE_HEAD` exists but its state dirs (rebase-merge /
 * rebase-apply) do not — git treats the operation as concluded and the
 * marker is a leftover breadcrumb (e.g. after a SIGKILL mid-rebase).
 * `git rebase --abort` errors in this state; the recovery paths remove
 * the marker (abort) or ignore it (finalize precheck).
 */
export function isOrphanRebaseMarker(gitDirAbs: string, fs: FsOps = defaultFs): boolean {
  if (!fs.existsSync(resolve(gitDirAbs, "REBASE_HEAD"))) return false;
  return !fs.existsSync(resolve(gitDirAbs, "rebase-merge"))
    && !fs.existsSync(resolve(gitDirAbs, "rebase-apply"));
}

/**
 * Result of inspecting the finalize lockfile at `repoRoot`. All fields are
 * populated even when the lockfile is absent — `present: false` simply
 * means the rest is undefined / zeroed.
 */
export interface LockfileScan {
  present: boolean;
  /** Absolute path to the lockfile (resolved against repoRoot). */
  path: string;
  /** PID string from the lockfile, or "<unknown>" if unparseable. */
  owner: string;
}

export function scanLockfile(
  repoRoot: string,
  fs: FsOps = defaultFs,
): LockfileScan {
  const lockPath = resolve(repoRoot, LOCK_FILENAME);
  if (!fs.existsSync(lockPath)) {
    return { present: false, path: lockPath, owner: "<unknown>" };
  }
  let owner = "<unknown>";
  try {
    const lockRaw = fs.readFileSync(lockPath, "utf8");
    const trimmed = lockRaw.trim();
    if (trimmed.length > 0) owner = trimmed;
  } catch { /* ignore read errors; surface as unknown */ }
  return { present: true, path: lockPath, owner };
}

/**
 * Remove the finalize lockfile if present. Returns true if a file was
 * removed, false if absent or already gone. Errors are swallowed (best-
 * effort GC, like the existing acquireFinalizeLock.release path).
 */
export function removeLockfile(
  repoRoot: string,
  fs: FsOps = defaultFs,
): boolean {
  const scan = scanLockfile(repoRoot, fs);
  if (!scan.present) return false;
  try {
    fs.unlinkSync(scan.path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse `git stash list` output into structured stash refs. Returns an
 * array of `{ ref, message }` for each line. Empty lines are skipped.
 * Exported so tests can drive it against canned stash output without
 * spawning `git`.
 */
export interface StashEntry {
  ref: string;
  message: string;
}

export function parseStashList(rawText: string): StashEntry[] {
  const out: StashEntry[] = [];
  for (const line of rawText.split("\n")) {
    if (line.length === 0) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const ref = line.slice(0, colonIdx).trim();
    const message = line.slice(colonIdx + 1).trim();
    out.push({ ref, message });
  }
  return out;
}

/**
 * Shape of a stash message the finalize flow pushes: `git stash push -m
 * worktree-finalize-<token>` renders as `<On|WIP on> <branch>:
 * worktree-finalize-<base36 token>` — the run label is the ENTIRE message
 * after the branch context. A stash that merely mentions the prefix inside
 * longer prose is user-authored and must never be selected (loop-lore
 * BUG-giwt-abort-runs-unscoped…: substring selection pops decoys).
 * Detached-HEAD contexts are not recognized — finalize only ever pushes
 * from a branch. Failing closed here only makes abort report "no leftover
 * finalize stashes"; it can never destroy anything.
 */
const FINALIZE_STASH_MESSAGE_RE = /^(?:On|WIP on) [^:]+: worktree-finalize-[0-9a-z]+$/;

/**
 * Filter a parsed stash list to only the entries that the finalize flow
 * pushed (whole-message run label). User-authored stashes are NEVER
 * returned — abort must not touch them.
 */
export function selectFinalizeStashes(entries: StashEntry[]): StashEntry[] {
  return entries.filter((e) => FINALIZE_STASH_MESSAGE_RE.test(e.message.trim()));
}

/** Positional index of a stash entry's `stash@{N}` ref. */
export function stashIndex(entry: StashEntry): number {
  const match = entry.ref.match(/^stash@\{(\d+)\}$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
