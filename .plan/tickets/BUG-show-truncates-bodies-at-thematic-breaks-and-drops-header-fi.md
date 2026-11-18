<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: show truncates bodies at thematic breaks and drops header fields

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

show.ts:70-79 stops the body at any line of 10+ dashes, so a markdown thematic break loses every later paragraph. Split on the Updates separator instead. git issue show emits Author/Created/Assignee/Milestone but ShowRecord only carries title/labels/priority/body; expose the remaining fields and test both changes.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
