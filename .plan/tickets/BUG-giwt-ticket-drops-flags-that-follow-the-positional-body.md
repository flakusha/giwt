<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt ticket drops flags that follow the positional body

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium

**Summary:**

Run: giwt ticket TASK TITLE --epic plan-tooling -F - — the --epic flag is not consumed: it lands in the Summary body and the command warns 'no --epic given'. Flags must be extracted before positional body capture.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
