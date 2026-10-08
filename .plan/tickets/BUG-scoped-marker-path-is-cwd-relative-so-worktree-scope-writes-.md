<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: scoped marker path is cwd-relative so worktree scope writes fail/misplace

**Status:** Done
**Priority:** high
**Effort:** Medium
**Tags:** bug, worktree

**Summary:**

writeScopedMeta wrote .git/giwt-scoped.json relative to the process cwd, not the worktree. In a linked worktree, .git is a file (not a directory), so the write fails with ENOTDIR. Worse, if the cwd is the main repo, the marker silently writes into the wrong repo. Two scoped-worktree tests pinned this. Fixed by 80bdfe2: scopedMarkerPath now resolves the git dir at the worktree path.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-08T03:48:25.526Z Fixed by 80bdfe2: scopedMarkerPath now resolves the git dir at the worktree path. Merged to master via fix-ticket-parse-template.
