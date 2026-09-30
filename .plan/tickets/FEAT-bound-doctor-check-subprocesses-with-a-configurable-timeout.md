<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: bound doctor check subprocesses with a configurable timeout

**Status:** Done (shipped: AbortSignal.timeout kills the child; boundedSpawn bounds the seam; [doctor] timeout_ms + --timeout)
**Priority:** high
**Effort:** Medium
**Tags:** doctor, reliability, timeout

**Summary:**

defaultSpawn (src/doctor/check.ts:645-655) runs every doctor check with `Bun.spawn(cmd, { stdout, stderr, cwd })` and awaits `proc.exited` with no deadline. The module docstring (check.ts:26-27) states the convention explicitly: 'Runners shell out via Bun.spawnSync (giwt convention: no timeouts, the operator owns cancellation).'

That convention has a cost now that checks run concurrently through a 4-worker pool (DOCTOR_JOBS_DEFAULT, check.ts:1038). A single wedged child — a tsc that stalls on a pathological file, a test runner waiting on a lock, a tool that prompts on a TTY — occupies one of four slots forever. The remaining three slots drain, and `giwt doctor check` never returns. There is no kill path and no way for a caller to bound it.

**Context:**

Fix: give the spawn a deadline and kill the child on expiry, surfacing it as a check error naming the command and the budget. Make the budget configurable rather than hardcoded, so a legitimately slow check can be given more.

Evidence: src/doctor/check.ts:26-27, 645-655, 1038

**Acceptance Criteria:**

- [x] defaultSpawn enforces a timeout and kills the child process on expiry
- [x] A timed-out check reports an error finding naming the command and the budget
- [x] The budget is configurable (default 120s) rather than a literal in the spawn call
- [x] The SpawnFn seam stays intact so tests can inject a hanging spawn without a real subprocess
- [x] A test injects a never-resolving spawn and asserts the check fails with a timeout finding instead of hanging

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
