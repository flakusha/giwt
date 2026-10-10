<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: reject manual edits to plan tickets index.json with a frontmatter-is-source-of-truth error

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** tickets, sync, plan

**Summary:**

Problem: .plan/tickets/index.json can be edited by hand today, silently diverging from ticket frontmatter. Frontmatter is the source of truth; the index is a derived artifact.

Requirement: loop-lore TASK-plan-index-tagging-binding-reconciliation acceptance criteria 7 (second half) and 8 - manual index edits are rejected with a clear error directing the user to edit the .md and run giwt sync.

Scope: detect out-of-band index writes/edits and refuse them with a message like: frontmatter is source of truth - edit the .md and run giwt sync. Add unit tests covering the rejection path and the happy path via giwt sync.

Acceptance criteria:

- [ ] Manual edit attempt produces the clear rejection error
- [ ] giwt sync continues to write the index normally
- [ ] Unit tests cover both paths

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
