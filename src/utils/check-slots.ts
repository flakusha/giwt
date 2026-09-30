// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * User-level semaphore bounding concurrent check fan-outs across ALL giwt
 * instances on one machine (FEAT-size-the-gate-fan-out-by-available-memory).
 *
 * The finalize lock already serializes finalize runs within one repo, but
 * each run's check phase spawns a full gate storm (tsc + test runner + knip +
 * jscpd — the doctor pool alone budgets 1 GB per tool), and nothing stopped
 * N agents on N repos from stacking N of those. Slots live under the user
 * cache dir (shared across repos and worktrees), one mkdir per holder: mkdir
 * is atomic, the holder count is readdir-free (capacity-indexed dirs), and
 * release is an idempotent rmdir that survives crashes (a stale slot from a
 * SIGKILLed holder narrows capacity until reboot — acceptable for a perf
 * heuristic; the wait path times out and proceeds regardless).
 *
 * Memory-derived capacity: one check tree is budgeted at
 * CHECK_TREE_MEM_BUDGET_MB — deliberately larger than the doctor pool's
 * per-tool budget because the tree RUNS that whole pool plus its own runtime.
 *
 * Env knobs (house pattern: REPO_ROOT/TREE_DIR/GIWT_LOG):
 * - GIWT_CHECK_SLOT_DIR      override the slot root (tests; hermetic fixtures)
 * - GIWT_CHECK_SLOT_WAIT_MS  override the contention wait (tests: 0)
 */

import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Memory budget for ONE concurrent check tree (the full gate storm), in MB.
 * Conservative: covers the doctor pool's 4 x 1 GB plus interpreter overhead. */
export const CHECK_TREE_MEM_BUDGET_MB = 4096;

/** Contention wait before a finalize proceeds without a slot. Contention is
 * a perf signal, never a blocker: finalize latency stays bounded. */
export const CHECK_SLOT_WAIT_MS = 30_000;

/** How many check trees the given available memory supports. Never 0 — a
 * starved box degrades to serial checks, it does not refuse them. */
export function checkSlotCapacity(availableMemMb: number): number {
  return Math.max(1, Math.floor(availableMemMb / CHECK_TREE_MEM_BUDGET_MB));
}

/** Slot root: user cache (cross-repo), overridable for hermetic tests. Env
 * precedence is a stable seam — finalize and every test must agree on it. */
export function checkSlotDir(): string {
  return process.env.GIWT_CHECK_SLOT_DIR
    ?? join(
      process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
      "giwt",
      "check-slots",
    );
}

/** Contention wait in ms, overridable for hermetic tests. Same seam logic as
 * checkSlotDir: tests must be able to zero the wait without settings churn. */
export function checkSlotWaitMs(): number {
  const raw = process.env.GIWT_CHECK_SLOT_WAIT_MS;
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return CHECK_SLOT_WAIT_MS;
}

export interface CheckSlot {
  /** Which capacity slot was taken (informational). */
  index: number;
  /** Idempotent: safe to call from both a finally block and the exit hook. */
  release: () => void;
}

/**
 * Take a capacity slot, waiting up to checkSlotWaitMs() for contention to
 * clear. Returns null when the wait expired — the CALLER then proceeds
 * without a slot and should warn; this function never blocks finalize
 * indefinitely and never refuses a run.
 */
export function acquireCheckSlot(opts: {
  dir: string;
  availableMemMb: number;
}): CheckSlot | null {
  const capacity = checkSlotCapacity(opts.availableMemMb);
  const deadline = Date.now() + checkSlotWaitMs();
  mkdirSync(opts.dir, { recursive: true });
  for (;;) {
    for (let i = 0; i < capacity; i++) {
      const slotPath = join(opts.dir, String(i));
      try {
        mkdirSync(slotPath);
        return {
          index: i,
          release: () => rmSync(slotPath, { recursive: true, force: true }),
        };
      } catch {
        // EEXIST: slot held by another instance — try the next.
      }
    }
    if (Date.now() >= deadline) return null;
    // Full-jitter poll (same de-phasing rationale as the finalize lock).
    Bun.sleepSync(50 + Math.floor(Math.random() * 50));
  }
}
