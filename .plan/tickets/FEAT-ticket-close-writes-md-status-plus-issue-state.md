<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: ticket close writes md status plus issue state

**Status:** Not Started
**Priority:** Medium
**Effort:** Small
**Tags:** ticket

**Summary:**

giwt state only flips git-issue state; nothing updates the md Status line, ticks acceptance boxes, or appends a resolution note. Recurring scratch need: update-tickets batch-closes with Status plus ticks plus note, close-ticket5 single-ticket close. Acceptance: one command closing a ticket end to end (md Status, acceptance ticks, resolution note, issue state) for one or many ids.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
