<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: add jitter to the finalize lock retry backoff

**Status:** Done (shipped: full jitter via lockRetryDelayMs, ceiling unchanged at 50 × ≤20ms)
**Priority:** high
**Effort:** Small
**Tags:** finalize, locking, concurrency

**Summary:**

acquireFinalizeLock retries 50 times with a fixed 20ms sleep (src/commands/finalize.ts:279-284):

    for (let attempt = 0; attempt < 50; attempt++) {
      if (tryCreate()) return release;
      if (reapStale()) return release;
      // Brief backoff before retry. 50 x 20ms = 1s ceiling.
      Bun.sleepSync(20);
    }

A fixed interval makes contending processes retry in lockstep. When N agents finalize into the same repo, each collision window is identical, so the retries stay synchronized and the herd repeatedly collides instead of spreading out. The lock is held for the whole merge sequence, so the 1s ceiling is routinely exhausted by the winner.

**Context:**

Fix: use randomized backoff (full jitter or equal-jitter) so contenders de-phase. Keep the 1s worst-case ceiling.

Evidence: src/commands/finalize.ts:279-284. The same fixed-20ms pattern exists in loop-lore's fork at scripts/worktree/commands/finalize.ts:201-203.

**Acceptance Criteria:**

- [x] The retry sleep is randomized rather than a fixed 20ms
- [x] The total acquisition ceiling stays at 1s (50 attempts)
- [x] The lock is still reaped (not reported held) when the owning process is gone
- [x] A test asserts two contenders acquiring the same lock do not retry in lockstep

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
