<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: giwt interconnect: derive producers/consumers/siblings from feature matrices

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Feature request: extend giwt interconnect/plan analysis to derive producers, consumers, and siblings of epics/tickets/bugs from feature matrices and interconnections, auto-analyzing and interconnecting items when related items update. Source: loop-lore research (feature matrices and interconnections).

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated (types doc)
**Resolved:** 2026-11-01T05:07:05.407Z
