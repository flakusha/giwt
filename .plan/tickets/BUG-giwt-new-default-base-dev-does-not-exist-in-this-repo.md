<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt new default base dev does not exist in this repo

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Epic:** quality
**Tags:** dx

**Summary:**

[branches] root defaults to 'dev' but this repo's long-lived branch is 'master', so the plain 'giwt new BRANCH' form always fails with 'base dev does not exist' and needs an explicit base. Set repo giwt.toml [branches] root = "master" (or make the default fall back to the current branch's merge-base target).

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-02T00:33:15.773Z fixed in fd11d0d: giwt.toml [branches] root = "master"; giwt new probe verified against master
