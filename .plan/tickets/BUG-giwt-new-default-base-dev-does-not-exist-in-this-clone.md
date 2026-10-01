<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt new default base dev does not exist in this clone

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium

**Summary:**

giwt.toml sets [branches] root = 'dev' but no local dev branch exists, so `giwt new NAME` fails until an explicit base is passed. Either create dev, or make new fall back to origin/HEAD with a warning when the configured root branch is absent.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
