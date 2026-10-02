<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: sync-index shadows imported raw (oxlint no-shadow)

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Epic:** quality
**Tags:** lint

**Summary:**

src/tickets/sync-index.ts:156 shadows the imported raw() output helper with a local 'raw' parameter. oxlint reports eslint(no-shadow) on every check run; lint target is 0/0. Rename the local to a non-shadowing name.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-02T00:33:02.096Z fixed in a5fb1c6: shadowed raw param renamed; oxlint src clean
