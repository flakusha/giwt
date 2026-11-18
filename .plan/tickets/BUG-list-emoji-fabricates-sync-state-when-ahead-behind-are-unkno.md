<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: list --emoji fabricates sync state when ahead/behind are unknown

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

list.ts:70-74 renders a green check when ahead/behind were omitted because getStatus failed (list.ts:41-43 deliberately omits them rather than writing zeros). Render the unknown state explicitly. list.ts:29 writes head 00000000 for unborn worktrees while the human path prints `<unknown>`; emit head null. Warn when multiple output flags are passed.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
