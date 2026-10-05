<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: Add author-identity guard to commit/merge paths

**Status:** Done
**Priority:** high
**Effort:** Medium

**Summary:**

GPG signing validates the COMMITTER, not the AUTHOR. A tampered repo user.email silently rewrites authorship while the signature stays valid. Added assertAuthorMatchesCommitter() to src/utils/author-guard.ts, wired into commit-wt.ts, commit.ts, merge.ts, and finalize/staging.ts (squash + direct merge). Escape hatch: --allow-author-override flag or GIWT_ALLOW_AUTHOR_OVERRIDE=1 env. 12 tests pass.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-05T10:47:21.871Z Universal coverage landed: staging single pre-mutation guard (all strategies, rebase included), scoped scope-commit, post-merge reconcile, rebase command, giwt git passthrough commit-class gate; staging teardown published to exit hook; msg file inside staging; commit-wt identity source fixed. Commit a768455.
