<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: advisory giwt lock status command

**Status:** Not Started
**Priority:** medium
**Effort:** Small
**Tags:** cli, agents, finalize

**Summary:**

Add a read-only `giwt lock` command that reports finalize lock holder/age/queue depth
and check-slot used/capacity/stale state, so an agent can preflight "is finalize
in-flight / is the queue deep / are check slots starved?" before starting a 10-minute
gate storm instead of discovering by collision.

**Context:**

Evidence (proposals doc 2026-10-14, P4):

- Finalize mutual exclusion: `.worktree-finalize.lock` + 50×≤20 ms full-jitter retries
  (src/commands/finalize/lock.ts:19-37), FIFO ticket queue `<lockfile>.queue/` with
  30-min patience (lock.ts:39-67). All visibility is **reactive**: `reportHeldLock`
  (finalize/lock-report.ts:40-70) prints holder PID/alive/age/recovery only when *you*
  collided.

- Check fan-out semaphore: capacity-indexed mkdir slots under
  `~/.cache/giwt/check-slots`, 4 GB/tree, 30 s wait then proceed
  (src/utils/check-slots.ts:35-67). A crashed holder "narrows capacity until reboot"
  (check-slots.ts:14-17); recovery is a manual `rm -rf` (check-slots.ts:17). No
  command lists current holders or waiters.

Design (composes existing primitives; ~100 L, module src/commands/lock.ts, registry
entry in src/cli-registry.ts):

- finalize: lock path from `LOCK_FILENAME` (abort/helpers.ts exports it;
  staging-sync.test.ts:28 imports it); holder via `readLockHolder(lockPath)` (extract
  the readFileSync+parseInt block of `reportHeldLock`); alive via `pidAlive`; age via
  `formatLockAge` (finalize/lock-report.ts:12-30); queue depth = count of entries in
  `<lockfile>.queue/`.

- check slots: `checkSlotDir()` + `checkSlotCapacity()` (check-slots.ts:49-56, 43-45)
  → used/capacity from the capacity-indexed dir listing. Slot dirs are named
  `0..cap-1` and store NO holder identity (check-slots.ts:90-97), so stale-holder
  detection is impossible from a read-only listing today — v1 reports used/capacity
  and repeats the documented recovery (`rm -rf` the slot root). Optional follow-up:
  have `acquireCheckSlot` write the holder PID into a file inside the slot dir (one
  line beside the mkdir at check-slots.ts:93) so a later version can flag stale slots
  via `pidAlive` — a deliberate schema addition, ship it behind the same env-seam
  discipline as the rest of the module or not at all.

- Output: ≤6 `key: value` lines + the P3 outcome line; `--json` via renderRecords.

Tradeoffs: PID-in-slot-dir is a schema change to a crash-tolerance primitive (release
path is `rmSync(slotPath, {recursive, force})`, check-slots.ts:96 — an extra file
inside the dir is removed with it). TOCTOU: the report is advisory by definition;
document that it gates nothing.

**Acceptance Criteria:**

- [ ] `giwt lock` prints ≤6 key:value lines: finalize held/free, holder pid + alive + age when held, queue depth, check slots used/capacity
- [ ] `giwt lock --json` renders the same facts via renderRecords
- [ ] With no lock and no slots used it exits 0 reporting free/idle; with a fixture lock file held by a live PID it reports held + holder + age (tests reuse the lock-report test fixtures)
- [ ] Read-only: the command creates/mutates no lock or slot state (test asserts no new files under a fixture tree dir or `GIWT_CHECK_SLOT_DIR`)
- [ ] Help text documents the advisory, gates-nothing nature (src/cli-usage.ts USAGE entry)
- [ ] `bunx tsc --noEmit` clean; `bun test` green
