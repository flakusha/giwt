<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: sync rewrites unbounded status lines and appendIssueRef drops separator

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** sync, md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

The header status fixer used to rewrite lines outside the 30-line metadata region and `appendIssueRef` consumed the `---` separator; both are constrained now. Residual: `rewriteHeaderStatusLines` rewrites every header Status line, clobbering appended `duplicate-of-*` done markers to `Done` even though the plan gate preserves them; skip duplicate-class values. Without a `---`, the issue ref is appended at EOF past the body rather than past the header region; anchor it at the header boundary and keep the separator-preserving path.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
