<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: doctor unclosed-resource leak check

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

No doctor check detects resource handles tests open but never close. Recurring scratch need: find-unclosed-db statically compares createTestDb call sites against close or destroy teardown. Acceptance: doctor sub-check flagging open-without-teardown resource patterns.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-01T02:12:54.085Z shipped in 38b44a5 on feat/new-tickets
