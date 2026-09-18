// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Manual recovery command for a finalize that left the dev checkout in a
 * bad state — for example, a `kill -9` (SIGKILL) that bypassed the signal
 * handler, or a crash between the stash push and the merge.
 *
 * What it does, in order:
 *
 *   1. Detect in-progress git operations on the dev checkout (MERGE_HEAD,
 *      REBASE_HEAD, CHERRY_PICK_HEAD) and abort each.
 *   2. Pop any leftover `worktree-finalize-*` stash entries — these are
 *      auto-pushed by `stashDevForMerge` before every merge. Pop conflicts
 *      fall back to `git reset --hard HEAD` so the dev tree is clean.
 *   3. Remove the finalize lockfile if present.
 *   4. Print a recovery report so the user can verify the state.
 *
 * Usage:
 *   giwt abort              # recover the dev checkout
 *   giwt abort --dry-run   # report only, no mutations
 *
 * Design notes:
 * - Idempotent. Running it twice in a row does the same thing.
 * - Never deletes user-authored stashes. We only touch entries whose message
 *   contains `worktree-finalize-`.
 * - Never force-deletes branches, never resets to a remote ref, never
 *   touches the worktree under `tree/`. The user owns those decisions.
 *
 * Testability:
 * - The pure helpers (lockfile scan / remove, stash list parsing) take an
 *   injectable file-system so unit tests can drive them without touching
 *   real repo state. Parallel-safe by construction: each call resolves
 *   files relative to the `repoRoot` argument and reads them via the
 *   injected `readFile` / `unlink` callbacks — no module-level mutable
 *   state, no shared temp dir.
 * - The full `abort` orchestrator still calls `git` via spawnSync and
 *   therefore must run against a real git repo (one per test fixture).
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "path";
import { type WorktreeConfig } from "../utils/config";
import { gitSync, gitSyncQuiet, isolatedGitEnv } from "../utils/git";
import { log, raw, section } from "../utils/output";

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
 * Filter a parsed stash list to only the entries that the finalize flow
 * pushed (message contains FINALIZE_STASH_PREFIX). User-authored stashes
 * are NEVER returned — abort must not touch them.
 */
export function selectFinalizeStashes(entries: StashEntry[]): StashEntry[] {
  return entries.filter((e) => e.message.includes(FINALIZE_STASH_PREFIX));
}

export async function abort(
  _args: string[],
  config: WorktreeConfig,
): Promise<void> {
  section("Finalize abort (manual recovery)");
  const dryRun = _args.includes("--dry-run");
  if (dryRun) log("warn", "DRY RUN: no mutations will be performed");
  const repoRoot = config.repoRoot;

  const gitDirRaw = gitSyncQuiet(repoRoot, "rev-parse", "--git-dir");
  const gitDirAbs = resolve(repoRoot, gitDirRaw.startsWith("/") ? gitDirRaw.slice(1) : gitDirRaw);

  // 1. Abort in-progress operations.
  for (const name of DEV_IN_PROGRESS_HEADS) {
    if (!existsSync(resolve(gitDirAbs, name))) continue;
    if (name === "REBASE_HEAD" && isOrphanRebaseMarker(gitDirAbs)) {
      // Orphan breadcrumb: the rebase already concluded (git's own state
      // dirs are gone) but the marker survived. `git rebase --abort`
      // errors in this state — remove the marker instead.
      log(
        "info",
        "Found orphan REBASE_HEAD (no rebase-merge/rebase-apply dirs) — removing stale marker",
      );
      if (!dryRun) {
        try {
          unlinkSync(resolve(gitDirAbs, name));
          log("success", "removed orphan rebase marker");
        } catch {
          log("warn", "could not remove orphan REBASE_HEAD — remove it manually");
        }
      }
      continue;
    }
    const op = IN_PROGRESS_ABORT_COMMAND[name];
    log("info", `Found ${name} — aborting in-progress ${op}...`);
    if (dryRun) continue;
    const result = Bun.spawnSync(
      ["git", "-C", repoRoot, op, "--abort"],
      { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
    );
    if (result.exitCode === 0) {
      log("success", `aborted in-progress ${op}`);
    } else {
      log("warn", `${op} --abort failed — you may need manual intervention`);
      raw(`  Stderr: ${result.stderr.toString().trim()}`);
    }
  }

  // 2. Pop leftover finalize stashes. Use the pure helpers so the
  // selection is testable in isolation; the actual `git stash pop` is a
  // subprocess that we run only against a real repo in production.
  const finalizeStashes = selectFinalizeStashes(
    parseStashList(gitSync(repoRoot, "stash", "list") ?? ""),
  );
  if (finalizeStashes.length === 0) {
    log("info", "No leftover finalize stashes");
  } else {
    log("info", `Found ${finalizeStashes.length} finalize stash(es)`);
    for (const entry of finalizeStashes) {
      log("info", `Restoring ${entry.ref}...`);
      if (dryRun) continue;
      const pop = Bun.spawnSync(
        ["git", "-C", repoRoot, "stash", "pop", entry.ref],
        { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
      );
      if (pop.exitCode === 0) {
        log("success", `restored ${entry.ref}`);
        continue;
      }
      log("warn", `${entry.ref} pop conflicted — preserving stash, cleaning tree`);
      const head = gitSyncQuiet(repoRoot, "rev-parse", "HEAD");
      const reset = Bun.spawnSync(
        ["git", "-C", repoRoot, "reset", "--hard", head],
        { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
      );
      if (reset.exitCode !== 0) {
        log("error", `reset --hard HEAD failed`);
        raw(`  Stderr: ${reset.stderr.toString().trim()}`);
      }
    }
  }

  // 3. Remove lockfile if present. Use the pure helper so the path is
  // computed identically to scanLockfile — no chance of drift.
  const lockScan = scanLockfile(repoRoot);
  if (lockScan.present) {
    log("info", `Found lockfile at ${lockScan.path} (owner PID ${lockScan.owner})`);
    if (!dryRun) {
      const removed = removeLockfile(repoRoot);
      if (removed) {
        log("success", "lockfile removed");
      } else {
        log("warn", `could not remove lockfile`);
      }
    }
  } else {
    log("info", "No lockfile present");
  }

  // 4. Final state report.
  raw("");
  log("info", "Final dev checkout state:");
  const head = gitSyncQuiet(repoRoot, "rev-parse", "--short", "HEAD");
  const branch = gitSyncQuiet(repoRoot, "branch", "--show-current") || "(detached)";
  raw(`  HEAD:   ${head}`);
  raw(`  Branch: ${branch}`);
  raw(`  Status: ${gitSyncQuiet(repoRoot, "status", "--porcelain") || "(clean)"}`);

  if (dryRun) {
    raw("");
    log("warn", "DRY RUN complete — no mutations performed. Re-run without --dry-run to apply.");
  } else {
    raw("");
    log("success", "Abort complete. Verify state, then re-run finalize if needed.");
  }
}
