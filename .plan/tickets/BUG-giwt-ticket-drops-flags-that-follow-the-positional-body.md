<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt ticket drops flags that follow the positional body

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

Run: giwt ticket TASK TITLE --epic plan-tooling -F - — the --epic flag is not consumed: it lands in the Summary body and the command warns 'no --epic given'. Flags must be extracted before positional body capture.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-02T00:33:09.355Z fixed in fd11d0d: parseTicketArgs single scan consumes known flags anywhere; -- separator; pinned in ticket.test.ts
