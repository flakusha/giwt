<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: narrow finalize lock to merge steps

**Status:** Not Started
**Priority:** high
**Effort:** Medium
**Tags:** lock, finalize

**Summary:**

Move acquireFinalizeLock and signal handlers inward to just before executeMergeStep. Gates run unlocked; re-check checkDevMergeable under lock.

**Context:**

The lock spans the gate storm: finalize.ts:138-179 acquires before runFinalize and releases after teardown. Steps 2-3 (checks, tests - minutes) hold the exclusive lock; queued finalizers age their base while waiting, widening the next rebase range and its conflict stops. Move acquireFinalizeLock + checkDevMergeable + signal-handler install (state.ts ACTIVE_ABORT_STATE, fed by the 3 setMergeInProgress sites in merge-exec.ts) inward to just before executeMergeStep. A gates-phase SIGINT then has no handler - safe (no lock held, no merge in progress, the exit hook no-ops on a null release) but that must be stated in a code comment, not assumed. The pre-lock checkDevMergeable becomes TOCTOU across minutes of gates, so re-check under lock before merging. The update-ref CAS from the staging-worktree ticket covers the residual race once the lock narrows.

**Acceptance Criteria:**

- [ ] Lock acquired just before executeMergeStep, released after teardown; gates run unlocked
- [ ] Signal handlers + publishActiveLockRelease move with the lock; gates-phase signal path documented in a comment
- [ ] checkDevMergeable re-run under lock before merge
- [ ] Queue waits drop from minutes to seconds; regression test covers a gates-phase signal with no lock held
