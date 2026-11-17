<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: show/search drop issues with hyphenated or spaced states

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

show.ts:47 and search.ts:24 match the bracketed state as \w+. Live git issue state --state 'duplicate-of-TASK-zzz' renders 'Issue f [duplicate-of-TASK-zzz]': show exits 1 with could-not-parse and search silently drops the hit. Accept any non-] state and map it via statusStyle; add parser tests for duplicate-of-* and Not Started. Related: TASK-show-state-resolve-plan-tickets-filename-slugs.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
