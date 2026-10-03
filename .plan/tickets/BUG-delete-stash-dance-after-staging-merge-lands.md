<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: delete stash dance after staging merge lands

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** stash, finalize

**Summary:**

Remove stashDevForMerge and restoreDevFromStash call sites once staging-WT merge ships. Keep abort legacy path until leftovers drain. Resolves abort-header versus restore-body reset contradiction.

**Context:**

Blocked on the staging-worktree ticket. Call sites to remove: merge-exec.ts:76 (squash), :154 (ff), :199 (direct), plus the signal path at state.ts:215. Keep the abort.ts legacy stash-pop path until old leftovers drain, then remove it too. This closes the documented contradiction: the abort.ts header promises a recovery that never resets, while restoreDevFromStash at merge.ts:139 runs an unscoped reset --hard on pop failure.

**Acceptance Criteria:**

- [ ] Zero stashDevForMerge / restoreDevFromStash call sites on the finalize path
- [ ] abort.ts legacy path retained with a drain note, or removed if no leftovers remain
- [ ] The abort-header versus restore-body reset contradiction is closed
- [ ] Full suite green
