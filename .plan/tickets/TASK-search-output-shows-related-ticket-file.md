<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: search output shows related ticket file

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** search, output
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`giwt search` results only named the issue/extid, so an agent had to look up the plan file separately. `search.ts` now maps extid/hash/git_issue to the indexed ticket path, exposes `SearchHit.file`, and renders it in human and machine output; add a regression asserting `--json` carries the `.plan/tickets/…md` path.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
