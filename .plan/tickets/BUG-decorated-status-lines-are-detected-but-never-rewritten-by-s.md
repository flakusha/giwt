<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: decorated Status lines are detected but never rewritten by sync fixers

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** sync, status
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`scanHeaderStatusLines` returns the leading `**` of a value-bolded line (`**Status:** **In Progress**`) as part of the value, so `resolveStatus` calls it invalid and `rewriteStatusLine` returns null. The sync fixer handles the same line correctly. Strip balanced value bold before classification and preserve it when rewriting; keep duplicate-of-* markers valid and never rewritten, and leave fenced-block/header bounds unchanged.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
