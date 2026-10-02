// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the finalize lock FIFO wait queue.
 *
 * Reproduces the contention pain: `acquireFinalizeLock` holds the lock for a
 * whole finalize (including the minute-scale gate storm), but the pre-queue
 * retry budget was 50 x <=20ms = 1s — under real contention every loser died
 * with "could not acquire finalize lock" instead of waiting its turn.
 *
 * Strategy: real child processes via `finalize-lock-fixture.ts` (modes
 * `hold:<ms>` and `queue`), because the queue lives inside Bun.sleepSync
 * poll loops and process-exit semantics that cannot run in-runner.
 *
 * Resource contract (parallel-safe): every test owns a private mkdtemp dir
 * (lock + queue + order.log live inside it), children get their env overrides
 * per-spawn, nothing global is touched, and afterEach removes the tmp dir.
 * Synchronization is by filesystem markers (ticket counts, order.log) and
 * stdout markers ("started"/"queued"), never wall-clock timers.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireFinalizeLock, queuePollDelayMs, queueWaitMs } from "./finalize";

const FIXTURE_PATH = join(import.meta.dirname, "../finalize-lock-fixture.ts");
const LOCK_NAME = ".worktree-finalize.lock";
const QUEUE_NAME = `${LOCK_NAME}.queue`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "giwt-finalize-queue-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Child {
  pid: number;
  exited: Promise<number>;
  output: () => string;
  waitForMarker: (marker: string) => Promise<void>;
}

/** Spawn one fixture child, draining stdout into a buffer. The marker
 * waiter resolves as soon as the marker appears (no timers). */
function spawnChild(mode: string, env?: Record<string, string>): Child {
  const proc = Bun.spawn(["bun", "run", FIXTURE_PATH, tmp, mode], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const decoder = new TextDecoder();
  let buffer = "";
  // Marker waiter hook: returns false once satisfied (unregisters itself).
  let notify: (() => boolean) | null = null;
  // Drain BOTH streams: log(error)/log(warn) go to stderr, and the
  // held-lock report the timeout test asserts on lives on stderr.
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (notify) notify();
    }
    buffer += decoder.decode();
    if (notify) notify();
  };
  void drain(proc.stdout);
  void drain(proc.stderr);
  return {
    pid: proc.pid,
    exited: proc.exited,
    output: () => buffer,
    waitForMarker: (marker: string) =>
      new Promise<void>((resolve, reject) => {
        if (buffer.includes(marker)) return resolve();
        notify = () => {
          if (buffer.includes(marker)) {
            resolve();
            return false;
          }
          return true;
        };
        // No wall-clock timeout: if the child dies before printing the
        // marker, the exit itself rejects — the failure names the cause.
        void proc.exited.then(() => {
          if (!buffer.includes(marker)) {
            reject(new Error(`marker '${marker}' never appeared; got: ${buffer}`));
          }
        });
      }),
  };
}

/** Deterministic fs sync: wait until the queue dir holds `n` tickets.
 * No event exists for directory growth, so this polls the CONDITION
 * (never a guessed duration) with a bounded deadline. */
function waitForTickets(n: number): void {
  // 30s: the waiter child must clear bun startup plus its 1s fast-path
  // retry budget; under a loaded CI box that can stretch well past 10s.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (queueEntries().length >= n) return;
    if (Date.now() >= deadline) {
      throw new Error(`queue never reached ${n} tickets; has: ${queueEntries()}`);
    }
    Bun.sleepSync(5);
  }
}

function queueEntries(): string[] {
  try {
    return readdirSync(join(tmp, QUEUE_NAME));
  } catch {
    return []; // queue dir absent — nobody has ever queued
  }
}

function orderLog(): number[] {
  try {
    return readFileSync(join(tmp, "order.log"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map(Number);
  } catch {
    return [];
  }
}

describe("finalize lock queue", () => {
  it("queues contending finalizes in arrival order (FIFO)", async () => {
    const holder = spawnChild("hold:600");
    await holder.waitForMarker("started");

    // Sync on the waiter's own queued log line (printed right after its
    // ticket lands) — a transient ticket can be missed by directory
    // polling if the holder releases before the waiter clears startup.
    // A waiter that instead acquired instantly (holder already gone under
    // extreme load) exits 0 without the line; either way ordering holds.
    const first = spawnChild("queue");
    await Promise.race([first.waitForMarker("queued (position"), first.exited]);
    const second = spawnChild("queue");
    await Promise.race([second.waitForMarker("queued (position"), second.exited]);

    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    await holder.exited;

    // Strict FIFO: acquisition order matches ticket (arrival) order.
    expect(orderLog()).toEqual([first.pid, second.pid]);
    // No residue: both tickets dequeued, holder's lock released.
    expect(queueEntries()).toEqual([]);
    expect(() => readdirSync(join(tmp, LOCK_NAME))).toThrow();
  }, 30_000);

  it("expires the queue budget with the held-lock report, leaving no ticket", async () => {
    const holder = spawnChild("hold:2000");
    await holder.waitForMarker("started");
    const waiter = spawnChild("queue", { GIWT_FINALIZE_QUEUE_WAIT_MS: "100" });
    waitForTickets(1);
    expect(await waiter.exited).toBe(1);
    expect(waiter.output()).toContain("could not acquire finalize lock");
    // The expired waiter removed its own ticket; the holder's lock remains.
    expect(queueEntries()).toEqual([]);
    expect(existsSync(join(tmp, LOCK_NAME))).toBe(true);
    await holder.exited;
  }, 30_000);

  it("reaps a ticket leaked by a SIGKILL-killed waiter", async () => {
    const holder = spawnChild("hold:1500");
    await holder.waitForMarker("started");
    const doomed = spawnChild("queue");
    // Ticket presence is the sync point: the fixture's queue branch runs
    // only AFTER acquisition returns, so there is no pre-acquire marker.
    waitForTickets(1);
    // SIGKILL bypasses every cleanup handler — exactly the leak scenario
    // the queue's PID-liveness reap exists to heal.
    process.kill(doomed.pid, "SIGKILL");
    expect(await doomed.exited).toBe(128 + 9);

    // The next waiter reaps the dead ticket, becomes head, and acquires
    // once the holder releases. Its reap must leave no residue.
    const next = spawnChild("queue");
    // Same race as the FIFO test above: under load the holder's 1500ms
    // budget can expire before this waiter even spawns, so it acquires
    // directly (exit 0, no 'queued' line) — the marker is a fast path,
    // not a guarantee.
    await Promise.race([next.waitForMarker("queued"), next.exited]);
    expect(await next.exited).toBe(0);
    await holder.exited;

    expect(orderLog()).toEqual([next.pid]);
    expect(queueEntries()).toEqual([]);
  }, 30_000);
});

describe("queue poll jitter", () => {
  it("draws are non-constant and bounded to [40, 160)", () => {
    const draws = Array.from({ length: 50 }, () => queuePollDelayMs());
    for (const d of draws) {
      expect(d).toBeGreaterThanOrEqual(40);
      expect(d).toBeLessThan(160);
    }
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});

describe("finalize queue in-process", () => {
  it("pins the default wait budget at 30 minutes", () => {
    const saved = process.env.GIWT_FINALIZE_QUEUE_WAIT_MS;
    delete process.env.GIWT_FINALIZE_QUEUE_WAIT_MS;
    try {
      expect(queueWaitMs()).toBe(30 * 60 * 1000);
    } finally {
      if (saved !== undefined) process.env.GIWT_FINALIZE_QUEUE_WAIT_MS = saved;
    }
  });

  /** Resource contract: owns this test's mkdtemp tmp dir only; the stubbed
   * `Bun.sleepSync` is installed and restored inside one synchronous block
   * (no await), so no other test can observe it — same justification as
   * finalize-lock-cleanup.test.ts's drainRetriesAgainstLiveHolder. */
  it("queues behind live tickets, reaps the dead one, and acquires", () => {
    const holder = Bun.spawn(["bun", "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      // Contended state: the lockfile is held by the live holder process;
      // the queue holds a DEAD waiter's ticket (SIGKILL leak) ahead of an
      // ALIVE one (the holder, double-booked here as a queued waiter). We
      // arrive last. The killed child stays a zombie (never reaped), so
      // pidAlive(its pid) stays true — which is exactly the live-ticket
      // semantics the fast-path fairness guard and head check rely on.
      const queueDir = join(tmp, QUEUE_NAME);
      mkdirSync(queueDir, { recursive: true });
      mkdirSync(join(queueDir, "000001-4194303")); // dead waiter
      mkdirSync(join(queueDir, `000002-${holder.pid}`)); // live waiter
      writeFileSync(join(tmp, LOCK_NAME), String(holder.pid));

      const foreignTicket = join(queueDir, `000002-${holder.pid}`);
      const sleeps: number[] = [];
      const sleepSpy = spyOn(Bun, "sleepSync").mockImplementation(
        ((ms: number) => {
          sleeps.push(ms);
          // Deterministic turn advance, no real time: poll 1 kills the
          // lock holder, and the live foreign waiter dequeues itself
          // (what a real waiter does on acquire or give-up). Poll 2: the
          // dead holder's exit hook releases the lockfile.
          if (sleeps.length === 1) {
            holder.kill();
            rmSync(foreignTicket, { recursive: true, force: true });
          } else if (sleeps.length === 2) {
            rmSync(join(tmp, LOCK_NAME), { force: true });
          }
        }) as unknown as typeof Bun.sleepSync,
      );
      const outSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        const release = acquireFinalizeLock(tmp);
        // We hold the lock now.
        expect(readFileSync(join(tmp, LOCK_NAME), "utf8")).toBe(String(process.pid));
        // The dead waiter's ticket was reaped; ours dequeued on acquire.
        expect(queueEntries()).toEqual([]);
        release();
        expect(existsSync(join(tmp, LOCK_NAME))).toBe(false);
      } finally {
        sleepSpy.mockRestore();
        outSpy.mockRestore();
      }
      // Fast path broke on the alive foreign ticket (no fast-loop sleeps),
      // then the wait loop polled twice before acquiring.
      expect(sleeps.length).toBe(2);
    } finally {
      holder.kill();
    }
  });
});
