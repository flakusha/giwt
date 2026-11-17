<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: resolver substring match resolves the wrong ticket for extid prefixes

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

resolver.ts:65-77 uses trimmed.toLowerCase().includes(stripped) over 'git issue ls --all', so TASK-alpha resolves to TASK-alphabet when that line sorts first. Prefer exact extid equality (case-insensitive); keep the documented substring fallback needed by TASK-show-state-resolve-plan-tickets-filename-slugs and add a prefix-collision regression test.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
