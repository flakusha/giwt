<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: stale worktree registry: list shows removed worktrees and branches

**Status:** Done
**Priority:** medium
**Effort:** Small

**Summary:**

Symptom: the giwt worktree registry drifts from git reality — list shows entries whose directories and branch refs are gone, create warns "already exists" for them, and remove errors out.

**Context:**

Evidence (2026-09-18, glm session 2026-09-18T00-34-50, loop-lore):

- 00:53:12 `giwt create skip-heavy-db` → "warn: worktree already exists" although the path does not exist on disk.
- `giwt list` still shows skip-heavy-db with HEAD adc0a0b5 while the branch ref does not exist at all (only the commit object does) — the agent diagnosed this via manual git inspection ("stale worktree registration").
- 00:54:23 `giwt remove` → "error: no worktree found for branch skip-heavy-db" while list still displayed it.

Acceptance:

- list/prune reconciles against `git worktree list` and ref existence, marking or dropping stale entries.
- create auto-prunes a stale entry instead of warning and failing.
- remove handles the stale case (prunes the registration) rather than erroring.
- Test with a registry entry whose dir and ref are deleted (mkdtemp scratch repo).

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
