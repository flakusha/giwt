// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "path";
import { log } from "../../utils/output";
import { formatLockAge, pidAlive, reportHeldLock } from "./lock-report";

const LOCK_FILENAME = ".worktree-finalize.lock";
// Finalize lock acquisition: retry budget. Ceiling stays 50 attempts,
// each sleeping at most 20ms — 1s worst case, unchanged by the jitter.
const LOCK_RETRY_ATTEMPTS = 50;
const LOCK_RETRY_MAX_MS = 20;

/**
 * Full-jitter backoff draw for one failed `acquireFinalizeLock` attempt.
 *
 * Contenders that retry on a fixed interval stay in lockstep and keep
 * colliding; drawing uniformly from [0, 20ms] de-phases them without
 * raising the worst case (still ≤20ms per attempt, 1s over 50 attempts).
 *
 * Exported so `finalize-lock-cleanup.test.ts` can assert the draw is
 * non-constant and bounded.
 */
export function lockRetryDelayMs(): number {
  return Math.floor(Math.random() * LOCK_RETRY_MAX_MS);
}

// FIFO wait queue for contending finalizes. The lockfile stays the sole
// mutual-exclusion authority; the queue only decides WHO tries next, so a
// concurrent queue-unaware giwt binary is still safe — it merely doesn't
// take a ticket and keeps racing the fast path.
const QUEUE_SUFFIX = ".queue";
const QUEUE_WAIT_MS_DEFAULT = 30 * 60 * 1000;

/**
 * Full-jitter poll draw while waiting in the finalize queue ([40, 160) ms).
 * Exported so the queue tests can assert the draw is non-constant and
 * bounded, mirroring `lockRetryDelayMs`.
 */
export function queuePollDelayMs(): number {
  return 40 + Math.floor(Math.random() * 120);
}

/** Wait budget for the finalize queue, overridable via env seam (house
 * pattern: GIWT_CHECK_SLOT_WAIT_MS / REPO_ROOT). Tests zero or shrink it;
 * production default gives a queued finalize a whole gate-storm's worth of
 * patience (30 min) instead of dying after the 1s fast-path budget.
 * Exported so tests can pin the default without waiting for it. */
export function queueWaitMs(): number {
  const envMs = process.env.GIWT_FINALIZE_QUEUE_WAIT_MS;
  if (envMs !== undefined && envMs !== "") {
    const parsed = Number(envMs);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return QUEUE_WAIT_MS_DEFAULT;
}

/**
 * Acquire an exclusive finalize lock on the dev checkout.
 *
 * Two concurrent `finalize` invocations race on `repoRoot`: each pushes a
 * stash, runs `git merge`, and pops the stash. Without a lock, A and B both
 * mutate the dev checkout's working tree; whichever finishes second pops
 * the other's stash onto a tree that may already be in rebasing/merge/
 * conflict state, leaving files in "modified" instead of cancelling cleanly.
 *
 * Lock primitive: atomic `O_CREAT|O_EXCL` via Node `openSync(path, 'wx')`.
 * The first caller wins; later callers fail fast. The lockfile content is
 * the PID, so a stale lock from a crashed prior run is detected via
 * `kill -0` and reaped automatically. An empty or corrupt lockfile
 * (SIGKILL between create and PID write) reaps the same way.
 *
 * Retry backoff is jittered, not fixed: contenders that retry on an
 * identical interval stay in lockstep, collide in the same window, and
 * keep colliding for as long as the winner holds the lock (the whole
 * merge sequence). A per-attempt random draw de-phases them.
 *
 * When the fast-path budget (1s) is exhausted under real contention — the
 * lock is held for a whole finalize including the minute-scale gate storm —
 * the loser no longer dies: it takes a FIFO ticket in `${lockPath}.queue/`
 * and waits for its turn, polling with jitter. Only the min-seq ALIVE ticket
 * attempts the lockfile, so acquisition follows arrival order and the herd
 * never thunder against the lockfile. Crashed waiters (SIGKILL leaves the
 * ticket behind) are reaped by PID liveness, same ESRCH semantics as the
 * stale-lockfile reap. A waiter killed while waiting (no signal handlers
 * are installed until after acquisition) leaks its ticket; the next waiter's
 * reap cleans it up. Wait budget: GIWT_FINALIZE_QUEUE_WAIT_MS (default
 * 30 min); on expiry the held-lock report is printed and we exit 1 — same
 * failure contract as before, just bounded by a real budget instead of 1s.
 *
 * Returns a release function the caller MUST invoke in a finally block.
 *
 * Exported for unit tests (`src/finalize-lock-cleanup.test.ts`)
 * that exercise the lock-acquire / exit-handler contract in isolation,
 * without requiring the full `finalize()` entry point (which needs a real
 * worktree + GPG key + dev checkout).
 * knip: only reachable from the test's child-process fixture
 * (`finalize-lock-fixture.ts`, run via spawn — not a static import knip
 * can trace), plus one intra-file call knip doesn't track.
 */
export function acquireFinalizeLock(repoRoot: string): () => void {
  const lockPath = resolve(repoRoot, LOCK_FILENAME);
  const myPid = process.pid;

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(myPid));
      closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };

  const reapStale = (): boolean => {
    let lockRaw = "";
    try {
      lockRaw = readFileSync(lockPath, "utf8").trim();
    } catch {
      return false;
    }
    const ownerPid = parseInt(lockRaw, 10);
    if (!Number.isFinite(ownerPid)) {
      // Empty or corrupt lockfile: a previous holder died between create
      // and PID write (SIGKILL leaves a 0-byte file). Reap and retry.
      try {
        unlinkSync(lockPath);
      } catch { /* best-effort */ }
      return tryCreate();
    }
    if (ownerPid === myPid) return false;
    try {
      process.kill(ownerPid, 0);
      // Owner still alive — keep their lock.
      return false;
    } catch (err) {
      // Only reap on ESRCH (process truly gone). EPERM means we lack
      // permission to signal the owner — typical for non-root agents
      // checking PID 1 (init) — but the process IS alive, so respect
      // its lock. Other errors fall through to retry that will fail
      // safely if the owner is actually gone.
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") return false;
    }
    try {
      unlinkSync(lockPath);
    } catch { /* best-effort */ }
    return tryCreate();
  };

  const release = (): void => {
    try {
      unlinkSync(lockPath);
    } catch { /* best-effort */ }
  };

  // --- FIFO wait queue --------------------------------------------------
  const queueDir = `${lockPath}${QUEUE_SUFFIX}`;
  let myEntry: string | null = null;

  const readQueue = (): Array<{ name: string; seq: number; pid: number; }> => {
    let names: string[];
    try {
      names = readdirSync(queueDir);
    } catch {
      return []; // Queue dir absent — nobody has ever queued.
    }
    return names
      .map((name) => {
        const m = /^(\d{6})-(\d+)$/.exec(name);
        return m ? { name, seq: parseInt(m[1]!, 10), pid: parseInt(m[2]!, 10) } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => a.seq - b.seq);
  };

  const enqueue = (): void => {
    mkdirSync(queueDir, { recursive: true });
    for (;;) {
      const maxSeq = readQueue().reduce((max, e) => Math.max(max, e.seq), 0);
      const name = `${String(maxSeq + 1).padStart(6, "0")}-${myPid}`;
      try {
        mkdirSync(join(queueDir, name));
        myEntry = name;
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        // Lost a seq race against a concurrent enqueuer — recompute.
      }
    }
  };

  const dequeue = (): void => {
    if (myEntry === null) return;
    const entry = myEntry;
    myEntry = null;
    try {
      rmSync(join(queueDir, entry), { recursive: true, force: true });
    } catch { /* best-effort */ }
  };

  const reapQueue = (): void => {
    for (const e of readQueue()) {
      if (e.pid === myPid || pidAlive(e.pid)) continue;
      try {
        rmSync(join(queueDir, e.name), { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  };

  // Release covers BOTH artifacts: the lockfile (authority) and our ticket.
  // Idempotent like `release` — the finally block and the `exit` hook may
  // both call it, and a waiter that won the lock still owns its ticket name.
  const releaseAll = (): void => {
    dequeue();
    release();
  };

  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt++) {
    // Fairness: if alive tickets are already queued, a fresh arrival must
    // not steal the lock through the fast path — it queues behind them.
    // (A queue-unaware OLD binary still races here; see the queue comment.)
    if (readQueue().some((e) => e.pid !== myPid && pidAlive(e.pid))) break;
    if (tryCreate()) return releaseAll;
    if (reapStale()) return releaseAll;
    // Jittered backoff: full jitter over [0, 20ms] so contenders
    // de-phase instead of retrying in lockstep. Ceiling unchanged at
    // 50 attempts × ≤20ms = 1s worst case.
    Bun.sleepSync(lockRetryDelayMs());
  }

  // Fast path exhausted: the holder is mid-finalize (gate storm = minutes).
  // Take a ticket and wait our turn instead of dying at the 1s budget.
  enqueue();
  const ahead = readQueue().filter((e) => e.pid !== myPid).length;
  log("info", `finalize lock busy — queued (position ${ahead + 1})`);
  const deadline = Date.now() + queueWaitMs();
  for (;;) {
    reapQueue();
    // Strict FIFO: only the oldest ALIVE ticket may touch the lockfile.
    // Everyone else sleeps — no thundering herd, no seq-order inversions.
    const head = readQueue()[0];
    if (head === undefined || head.pid === myPid) {
      if (tryCreate()) {
        dequeue();
        return releaseAll;
      }
      if (reapStale()) {
        dequeue();
        return releaseAll;
      }
    }
    if (Date.now() >= deadline) {
      dequeue();
      reportHeldLock(lockPath);
      log(
        "error",
        `gave up after ${
          formatLockAge(Date.now() - (deadline - queueWaitMs()))
        } in the finalize queue (budget: GIWT_FINALIZE_QUEUE_WAIT_MS=${queueWaitMs()})`,
      );
      process.exit(1);
    }
    Bun.sleepSync(queuePollDelayMs());
  }
}
