<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: rebase auto-resolve superset-side conflicts

**Status:** Done
**Priority:** Medium
**Effort:** Small
**Tags:** git, rebase

**Summary:**

No command detects that one conflict side is a pure superset of the other. Recurring scratch need: check-superset checks unmerged files for a superset relation to resolve by taking upstream. Acceptance: rebase or merge path auto-resolves pure-superset conflicts with a logged reason, refuses otherwise.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-01T02:12:54.147Z shipped in 38b44a5 on feat/new-tickets
