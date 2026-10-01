<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: rebase auto-resolve superset-side conflicts

**Status:** Not Started
**Priority:** Medium
**Effort:** Small
**Tags:** git, rebase

**Summary:**

No command detects that one conflict side is a pure superset of the other. Recurring scratch need: check-superset checks unmerged files for a superset relation to resolve by taking upstream. Acceptance: rebase or merge path auto-resolves pure-superset conflicts with a logged reason, refuses otherwise.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
