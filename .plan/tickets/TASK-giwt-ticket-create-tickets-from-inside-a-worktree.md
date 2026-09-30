<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: giwt ticket: create tickets from inside a worktree

**Status:** Done
**Priority:** high
**Effort:** Medium

**Summary:**

Currently giwt ticket resolves .plan/ against the repo root checkout; running it inside tree/`<branch>` either writes to the wrong .plan or fails. Worktrees are the sanctioned mutation surface (loop-lore AGENTS.md: all mutating ops worktree-only), so ticket creation must work there.

**Context:**

Requirements:

- giwt ticket run inside tree/`<branch>` writes the ticket .md and registers the git issue against that worktree's .plan/tickets/ (branch-local), not the root checkout.
- git issue registry is repo-shared (git notes/refs) — verify issue creation works from a linked worktree and index hash linkage stays consistent.
- Reconcile with giwt sync/plan validate run in the same worktree so the branch can carry the new ticket until merge.
- Tests: fixture worktree scenario for ticket creation + index registration.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
