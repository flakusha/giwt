<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: giwt code-map: scan-path support for packages/ (monorepo)

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Feature request: extend giwt plan code-map scan paths (currently planDir/tickets, epics, docs/spec, docs/frontend) to also scan packages/ so monorepo layouts are covered. Source: loop-lore MonorepoMigrationPlan.md §3.3.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated (module doc)
**Resolved:** 2026-11-01T05:07:05.225Z
