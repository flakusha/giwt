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

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireFinalizeLock } from "./commands/finalize";

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
    mode: "exit" | "signal" | "normal",
  ): Promise<{ exitCode: number; leaked: boolean; }> {
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
      return { exitCode: code, leaked };
    }
    const proc = Bun.spawn(["bun", "run", FIXTURE_PATH, tmp, mode], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const leaked = out.includes("LEAK");
    return { exitCode: code, leaked };
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
