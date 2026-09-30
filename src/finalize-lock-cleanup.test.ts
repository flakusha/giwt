// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the finalize lock-release-on-exit contract.
 *
 * Reproduces the user-reported bug ("lock often stays in place on finalize
 * failure") and verifies the fix:
 *
 *   - The `process.on('exit')` handler installed by `installSignalHandlers`
 *     releases the lock on every termination path that goes through Node
 *     (process.exit, signal, unhandled throw).
 *   - SIGKILL (`kill -9`) bypasses every handler — that's documented in
 *     AGENTS.md as the `giwt abort` recovery path, not a unit
 *     test concern.
 *
 * Strategy: drive the real `finalize` entry point through a child process
 * running a self-contained fixture script. The fixture imports the same
 * helpers and calls the lock acquire/release path under three exit modes:
 *   1. `process.exit(1)` (the operator-error path that was leaking)
 *   2. Signal-triggered exit (`SIGUSR1`)
 *   3. Normal exit (the success path that was already correct)
 *
 * Each scenario verifies the lockfile is absent afterwards. The fixture
 * uses a per-test tmp directory and a unique lockfile name so concurrent
 * test runs do not collide.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireFinalizeLock, lockRetryDelayMs } from "./commands/finalize";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "giwt-finalize-lock-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("finalize lock cleanup", () => {
  /**
   * Drive each exit mode through a child process. The fixture script
   * imports the real `acquireFinalizeLock` from finalize.ts, simulates
   * one of the three exit modes, and prints "OK" or "LEAK" based on
   * whether the lockfile still exists immediately before the process
   * actually terminates.
   *
   * Using a child process is the only way to exercise the real exit
   * semantics — `process.exit` inside a `bun test` block would tear
   * down the test runner itself.
   */
  const FIXTURE_PATH = join(import.meta.dirname, "finalize-lock-fixture.ts");

  async function runFixture(
    mode: "exit" | "signal" | "normal" | "slot",
    slotDir?: string,
  ): Promise<{ exitCode: number; leaked: boolean; slotLeaked: boolean; }> {
    if (mode === "signal") {
      // For the signal case we run the fixture, then send SIGUSR1 to its
      // pid with SIGHUP, then await its exit. Done inline here (not in the fixture)
      // so the test can read the fixture's PID back and signal it.
      // We deliberately do NOT use a wall-clock timer — we await the
      // fixture's `started` marker (a single console.log line) before
      // sending, which is deterministic and race-free.
      const proc = Bun.spawn(["bun", "run", FIXTURE_PATH, tmp, mode], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NODE_ENV: "test" },
      });
      // Drain the stream with a manual reader so we can detect the
      // fixture's `started` marker before sending SIGHUP — without a
      // wall-clock timer. We collect chunks into a buffer and inspect
      // after each read; when "started" has been seen we signal the
      // fixture and wait for it to exit.
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!buffer.includes("started")) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      // SIGHUP, not SIGUSR1: Bun reserves SIGUSR1 for its inspector and
      // never delivers it to user handlers (verified: default kill, 138).
      process.kill(proc.pid, "SIGHUP");
      const code = await proc.exited;
      // Drain the tail — the fixture prints LEAK/OK from its exit handler.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      buffer += decoder.decode();
      const leaked = buffer.includes("LEAK");
      return { exitCode: code, leaked, slotLeaked: false };
    }
    const proc = Bun.spawn(["bun", "run", FIXTURE_PATH, tmp, mode, ...(slotDir ? [slotDir] : [])], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const leaked = out.includes("LEAK") && !out.includes("SLOT-LEAK");
    const slotLeaked = out.includes("SLOT-LEAK");
    return { exitCode: code, leaked, slotLeaked };
  }

  it("releases the lock when finalize calls process.exit(1)", async () => {
    const r = await runFixture("exit");
    expect(r.exitCode).toBe(1);
    expect(r.leaked).toBe(false);
  });

  it("releases the lock on signal-triggered exit", async () => {
    const r = await runFixture("signal");
    expect(r.exitCode).toBe(130);
    expect(r.leaked).toBe(false);
  });

  it("releases the lock on normal exit", async () => {
    const r = await runFixture("normal");
    expect(r.exitCode).toBe(0);
    expect(r.leaked).toBe(false);
  });

  it("releases the check-fanout slot on process.exit(1)", async () => {
    // Real-child proof for the slot half of the exit hook: a process dying
    // while holding a slot must free it, or a SIGKILLed agent's slot would
    // narrow the machine-wide capacity until reboot.
    const slotRoot = mkdtempSync(join(tmpdir(), "giwt-check-slots-fixture-"));
    try {
      const r = await runFixture("slot", slotRoot);
      expect(r.exitCode).toBe(1);
      expect(r.slotLeaked).toBe(false);
      // Belt and suspenders: assert the directory itself, not just the
      // fixture's self-report.
      expect(readdirSync(slotRoot)).toEqual([]);
    } finally {
      rmSync(slotRoot, { recursive: true, force: true });
    }
  });
});

describe("finalize lock stale-reap", () => {
  const LOCK_NAME = ".worktree-finalize.lock";
  /**
   * @param content
   */
  function acquireOverStale(content: string): () => void {
    const lockPath = join(tmp, LOCK_NAME);
    writeFileSync(lockPath, content);
    const release = acquireFinalizeLock(tmp);
    expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
    return release;
  }

  it("reaps an empty lockfile left by a SIGKILL between create and PID write", () => {
    const release = acquireOverStale("");
    release();
  });

  it("reaps a corrupt lockfile", () => {
    acquireOverStale("not-a-pid")();
  });

  it("reaps a lockfile whose owner PID is gone", () => {
    acquireOverStale("4194303")();
  });
});

describe("finalize lock retry jitter", () => {
  /**
   * A fixed 20ms retry interval makes contending processes wake in
   * lockstep, so every collision happens in the same window and the
   * herd never spreads out. `lockRetryDelayMs` draws full jitter over
   * [0, 20ms] instead.
   *
   * Sampling is probabilistic, so the assertion is deliberately coarse:
   * many draws, more than one distinct value, every value inside the
   * per-attempt cap. We never pin a specific draw — only the invariant
   * (bounded, non-constant) that makes lockstep impossible.
   */
  const SAMPLES = 200;

  it("draws varying backoffs, each within the 20ms per-attempt cap", () => {
    const samples = Array.from({ length: SAMPLES }, () => lockRetryDelayMs());

    // Non-lockstep: 200 independent draws from 21 values are all-but
    // guaranteed to differ somewhere.
    expect(new Set(samples).size).toBeGreaterThan(1);
    // Bounded above by the per-attempt cap so the 1s acquisition
    // ceiling over 50 attempts is preserved.
    for (const ms of samples) {
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(20);
    }
  });

  /**
   * Drive `acquireFinalizeLock` against a lock owned by a process that is
   * genuinely alive, so the lock is never reapable and the retry loop runs
   * to exhaustion. `Bun.sleepSync` is stubbed to record the requested delay
   * without really sleeping, so the loop costs microseconds instead of the
   * full 1s ceiling.
   *
   * Resource contract — this stubs process-wide globals, so it is only safe
   * because the stub window is strictly synchronous:
   *   - The stub is installed and restored inside one synchronous block with
   *     no `await` in between, so no other test in this file (or any other
   *     file) can observe it. Verified empirically: a second test file's real
   *     `Bun.sleepSync(80)` still slept the full 80ms while a stub was held
   *     for 600ms of blocking CPU. bun also loads each test file in its own
   *     scope, so there is no cross-file stub sharing to reason about.
   *   - Owns exactly one thing: a unique lockfile inside this test's own
   *     `mkdtemp` tmp dir (from the file-level `beforeEach`), removed by the
   *     `afterEach`. No fixed path, no shared repo, no port.
   *   - The holder child process is killed in `finally`, so a failing
   *     assertion cannot leak a process into the rest of the run.
   *   - Each of the two tests below creates its own holder and its own
   *     lockfile, so neither depends on the other's state or their order.
   *
   * Returns the recorded sleep arguments, or `null` if the lock was
   * unexpectedly acquired (i.e. the holder was reaped).
   */
  function drainRetriesAgainstLiveHolder(): { delays: number[]; exited: number | null; } | null {
    const holder = Bun.spawn(["bun", "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const delays: number[] = [];
    const sleepSpy = spyOn(Bun, "sleepSync").mockImplementation(
      ((ms: number) => {
        delays.push(ms);
      }) as unknown as typeof Bun.sleepSync,
    );
    const outSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    let exited: number | null = null;
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        exited = code ?? 0;
        throw new Error(`__exit__:${code}`);
      }) as never,
    );
    try {
      writeFileSync(join(tmp, ".worktree-finalize.lock"), String(holder.pid));
      let acquired = false;
      try {
        acquireFinalizeLock(tmp)();
        acquired = true;
      } catch (err) {
        if (!(err instanceof Error) || !err.message.startsWith("__exit__")) throw err;
      }
      return acquired ? null : { delays, exited };
    } finally {
      exitSpy.mockRestore();
      outSpy.mockRestore();
      sleepSpy.mockRestore();
      holder.kill();
    }
  }

  it("jitters the real retry loop instead of sleeping a fixed 20ms", () => {
    const run = drainRetriesAgainstLiveHolder();
    // The holder was alive, so the lock must NOT have been reaped — a null
    // return means the loop never ran, which would make the rest vacuous.
    expect(run).not.toBeNull();
    const { delays, exited } = run!;

    // A held lock is still reported, not silently abandoned.
    expect(exited).toBe(1);
    // The wiring: these are the delays the loop actually requested. Reverting
    // the loop to a fixed `Bun.sleepSync(20)` makes every entry 20 and fails
    // the distinctness check below — that is the regression this guards.
    expect(delays.length).toBeGreaterThan(1);
    expect(new Set(delays).size).toBeGreaterThan(1);
    for (const ms of delays) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(20);
    }
  });

  it("keeps the acquisition ceiling at 50 attempts", () => {
    const run = drainRetriesAgainstLiveHolder();
    expect(run).not.toBeNull();
    // 50 sleeps recorded = 50 attempts against a lock that is never reapable.
    // With each sleep at most 20ms this is the documented 1s worst case.
    expect(run!.delays.length).toBe(50);
  });
});
