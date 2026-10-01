<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize-lock-queue test flakes marker queued never appeared got OK

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Epic:** quality
**Tags:** tests

**Summary:**

finalize-lock-queue.test.ts intermittently fails with "marker 'queued' never appeared; got: OK" (observed during coverage runs in linked worktrees). The waiter acquires immediately instead of queueing — likely lock-release race between fixture child and parent. Investigate and make deterministic.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
