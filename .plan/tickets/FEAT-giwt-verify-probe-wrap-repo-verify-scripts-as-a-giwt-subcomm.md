<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: giwt verify probe: wrap repo verify scripts as a giwt subcommand

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Cross-repo feature request. Wrap repository verify/probe scripts (currently living under .tmp/intercom/scripts) into a  subcommand so they are reusable across repos instead of duplicated as local scripts. Source: loop-lore SCRIPT-PROMOTION-SPEC-2026-10-31.md.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated (USAGE help is the doc)
**Resolved:** 2026-11-01T05:07:04.939Z
