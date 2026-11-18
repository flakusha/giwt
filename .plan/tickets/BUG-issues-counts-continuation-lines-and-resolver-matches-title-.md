<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: issues counts continuation lines and resolver matches title prose

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** issues, resolver
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`git issue ls --format full` indents detail/continuation lines, so a line-based counter inflated `issues (N)` and a resolver using substring matching could match a title's prose. `issues.ts` now counts `parseIssueSearch` hits (with the same cap predicate) and `resolver.ts` requires exact extid equality before a leading-token fallback. Add/fill regression coverage for indented detail lines and prefix-collision lookups.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
