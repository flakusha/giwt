<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: size the gate fan-out by available memory, not only by core count

**Status:** Done (doctor pool: effectiveJobs clamp, DOCTOR_PER_WORKER_MEM_MB 1024 MB/worker, [doctor] memory_budget_mb override, sizing in report.jobs; finalize: cross-instance check-fanout slots in src/utils/check-slots.ts, 4096 MB/tree, contention warns never refuses)
**Priority:** Medium
**Effort:** Medium
**Tags:** lifecycle, memory, concurrency

**Summary:**

Both lifecycle fan-out points size their concurrency from a fixed constant, so peak RSS is unbounded by how much memory the box actually has left. A wedged or merely memory-hungry sibling makes the OOM killer take an arbitrary process — often the `bun test` or `tsc` holding a worker slot, whose death surfaces as an opaque exit 137 rather than a diagnosis.

The doctor pool already documents memory as its reason for the cap:

> the safe default (4) keeps peak memory bounded on big projects where tests + tsc + knip + jscpd each spawn heavy toolchains

— `src/doctor/check.ts:1163-1165`. That reasoning is correct but the number is a constant, not a measurement. `DOCTOR_JOBS_DEFAULT = 4` (check.ts:1131) is applied verbatim on a 32-core/64 GB box (measured: `availableParallelism()=32`, `totalmem()=61.9 GB`, `freemem()=34.9 GB`) and on a 4-core/4 GB laptop, where the same 4 is far too many.

Finalize has the same shape one level up: `runCheck` (src/commands/finalize.ts:719-740) shells out to the whole `check` command as a single child, and that child then runs `check:parallel` over the same gates. Two `giwt finalize` runs in two worktrees therefore stack two full gate fan-outs on one box, with nothing coordinating them.

**Context:**

The repo already accepts that contention is real — the finalize lock exists and its retry backoff is jittered (`lockRetryDelayMs`, finalize.ts:212-214) precisely because contenders collide in lockstep. But the lock only serializes the *merge*. The check fan-out happens before the lock is taken and runs independently in every session, so N concurrent agents means N simultaneous `tsc` + `bun test` + `knip` + `jscpd` storms. The lock prevents interleaved merges; it does nothing about concurrent memory.

Three concrete failure shapes, in increasing severity:

1. Silent under-utilization. On a big box, 4 jobs wastes the machine — `knip` and `jscpd` are I/O-bound and barely contend for CPU, so the run is 4x slower than it needs to be.
2. Wedge-plus-slot-loss. The timeout fix (FEAT-bound-doctor-check-subprocesses-with-a-configurable-timeout) already kills a wedged child after 120 s. But a child killed by the OOM killer is not a child that respects a deadline — it can die mid-write, leaving a truncated capture.
3. OOM kill of the wrong process. With no memory floor check, the kernel picks the largest RSS. That is frequently `bun test`, whose SIGKILL shows up as a bare exit 137 in a gate stream with no explanation.

Fix: derive the effective job count from a memory budget at dispatch time, and expose it as a setting so a box with unusual cgroup limits can be tuned.

**Acceptance Criteria:**

- [ ] Effective job count is capped by available memory, not only by the fixed constant; the cap is computed at dispatch time, not at module load
- [ ] The memory budget is configurable via settings (e.g. `[doctor] memory_budget_mb`) with a sane default, and exposed on the existing `doctor check` surface
- [ ] A low-memory condition is reported, not silently swallowed — the run record / report names that the pool was clamped and to what
- [ ] `finalize` participates: the check fan-out accounts for other live `giwt` instances rather than assuming it is alone on the box
- [ ] Pool sizing is pure and injectable so tests can drive a low-memory case without allocating real memory
- [ ] A test asserts the pool clamps to the memory budget, and that the clamp reason appears in the report
