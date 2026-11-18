<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: plan validate: resolve 7 residual gate errors after the feature wave

**Status:** Done
**Priority:** low
**Effort:** Medium
**Tags:** plan, validate
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

This ticket was written against an older HEAD; its three named error classes are gone. Current `giwt plan validate` reports 4 links-gate errors only: backtick-free example extids `TASK-zzz` (twice) in .plan/tickets/BUG-show-search-drop-issues-with-hyphenated-or-spaced-states.md:13 and `TASK-alpha`/`TASK-alphabet` in .plan/tickets/BUG-resolver-substring-match-resolves-the-wrong-ticket-for-extid.md:13. epics-doc, status-vocab, matrix, and interconnect gates are green. The fix is mechanical: backtick those example ids (inline code is stripped before task-ref collection) and re-run the links gate; `applyLinkFixes` cannot repair scan orphans.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
