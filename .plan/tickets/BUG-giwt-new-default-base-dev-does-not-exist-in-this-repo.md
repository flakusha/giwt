<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt new default base dev does not exist in this repo

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Epic:** quality
**Tags:** dx

**Summary:**

[branches] root defaults to 'dev' but this repo's long-lived branch is 'master', so the plain 'giwt new BRANCH' form always fails with 'base dev does not exist' and needs an explicit base. Set repo giwt.toml [branches] root = "master" (or make the default fall back to the current branch's merge-base target).

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
