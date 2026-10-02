<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize-lock-queue test flakes marker queued never appeared got OK

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Epic:** quality
**Tags:** tests

**Summary:**

finalize-lock-queue.test.ts intermittently fails with "marker 'queued' never appeared; got: OK" (observed during coverage runs in linked worktrees). The waiter acquires immediately instead of queueing — likely lock-release race between fixture child and parent. Investigate and make deterministic.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-02T00:33:09.568Z fixed in fd11d0d: test awaited un-raced queued marker; under load the waiter acquires directly (OK, no marker). Now races marker vs exit like the FIFO test. 20/20 local runs green
