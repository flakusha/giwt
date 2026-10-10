<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: plan metadata subcommand - promote frontmatter-wins projection from loop-lore

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** plan, tickets, sync

**Summary:**

Problem: loop-lore scripts/plan/normalize-plan-metadata.ts implements a frontmatter-wins projection (commits 1f970fa and 125de19) that belongs in giwt.

Scope: add a giwt plan metadata subcommand porting that behavior:

- backfill empty tag arrays
- repair divergent tag arrays (frontmatter wins)
- leave md files with no Tags line untouched
- retain stale tags when the Tags line is deleted (documented semantic - port the retention test too)
- --dry-run mode
- honors the worktree index-write guard (skip and report deferred)

loop-lore keeps its package.json alias plan:metadata pointing at the pinned giwt once shipped.

Acceptance criteria:

- [ ] All four projection behaviors ported with the retention semantic preserved
- [ ] Retention test ported alongside the loop-lore version
- [ ] --dry-run makes no writes
- [ ] Worktree index-write guard honored
- [ ] loop-lore plan:metadata alias migration documented

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
