<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: shell injection via extid in auto-close git issue messages

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** sync, security
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

The auto-close message used to be built into a shell string, so an extid containing quotes and `; echo …` could execute commands. `closeStaleOpenIssues` now passes the message as a single `execFileSync` argv element with a regression test using an injection-shaped extid. Remaining work is hardening the two leftover git shell-string spawns in sync-registry.ts (`issue ls`) and sync-reconcile.ts (`cat-file -e`) to argv form; both inputs are currently static or hex-guarded.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
