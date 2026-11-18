<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: ticket close half-closes and lookup prefers commit hash

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** ticket, close
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`ticket close` used to rewrite .md files before closing git issues, and `issueHashFor` preferred the legacy `hash` field over a real `git_issue` link; a shipped commit hash could close the wrong issue. Ordering and lookup are fixed (issues close first, `git_issue` wins, registry walk last). Residual: the close loop throws on the first failure, so with several tickets an earlier issue is closed while no .md is rewritten. Isolate per-ticket failures, rewrite only successfully closed tickets, report failures and exit non-zero at the end.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
