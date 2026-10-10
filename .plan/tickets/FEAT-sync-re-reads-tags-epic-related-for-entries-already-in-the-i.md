<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: sync re-reads tags epic related for entries already in the index on every sync

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** tickets, sync, plan

**Summary:**

Problem: giwt sync reads tags/epic/related from frontmatter only when adopting orphans. Entries already present in .plan/tickets/index.json never reconcile, so frontmatter edits after initial filing never reach the index.

Requirement: loop-lore .plan/tickets/TASK-plan-index-tagging-binding-reconciliation.md acceptance criteria 1 and 2 - frontmatter is the source of truth; every sync re-reads these fields for existing entries and updates the index accordingly.

Constraints: must respect the linked-worktree index-write guard in src/tickets/sync-index-write.ts (skip the write and report it as deferred rather than failing).

Acceptance criteria:

- [ ] Changing Tags/Epic/Related frontmatter in a ticket md and running giwt sync updates the existing index entry
- [ ] Inside a linked worktree the write is skipped and reported deferred
- [ ] Tests added in the sync-index test family following sync-index-run.test.ts conventions

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
