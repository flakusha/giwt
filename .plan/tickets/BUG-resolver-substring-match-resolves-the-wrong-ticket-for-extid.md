<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: resolver substring match resolves the wrong ticket for extid prefixes

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

resolver.ts:65-77 uses trimmed.toLowerCase().includes(stripped) over 'git issue ls --all', so `TASK-alpha` resolves to `TASK-alphabet` when that line sorts first. Prefer exact extid equality (case-insensitive); keep the documented substring fallback needed by TASK-show-state-resolve-plan-tickets-filename-slugs, make the fallback unambiguous when several extids share the prefix, and add a prefix-collision regression test.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
