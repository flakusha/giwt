<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt new default base dev does not exist in this clone

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

giwt.toml sets [branches] root = 'dev' but no local dev branch exists, so `giwt new NAME` fails until an explicit base is passed. Either create dev, or make new fall back to origin/HEAD with a warning when the configured root branch is absent.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-02T00:33:15.871Z duplicate-of-BUG-giwt-new-default-base-dev-does-not-exist-in-this-repo: same missing-dev root cause, same giwt.toml root=master fix (fd11d0d)
