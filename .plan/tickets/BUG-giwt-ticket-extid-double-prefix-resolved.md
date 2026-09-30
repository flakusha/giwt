<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt-ticket-extid-double-prefix-resolved

**Status:** Done (fix shipped in 6e6e7d6; colon-form hardening + lockstep review landed 2026-09-25)
**Priority:** low
**Effort:** Medium

**Summary:**

Fix shipped in 6e6e7d6. See /home/flak/git-ai/loop-lore/.plan/tickets/BUG-giwt-ticket-extid-double-prefix-on-duplicate-type-slug.md for the loop-lore-side retrospective ticket that flagged it.

**Context:**

- `stripTypePrefix` implementation + call site verified: only the git-issue
  prose is stripped; the .md filename/extid keep the full title kebab.
- Gap found and closed: the colon form (`giwt ticket BUG "BUG: story ui"`)
  still produced a double prefix — the strip trigger now accepts space,
  dash, **and colon** (tests in `src/commands/ticket.test.ts`).
- Live drift from the original filing (orphan issue `d3b099e` carrying the
  double-prefixed title) reconciled via `giwt sync --fix` + manual title edit.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
