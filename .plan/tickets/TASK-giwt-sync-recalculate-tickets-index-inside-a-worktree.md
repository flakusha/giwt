<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: giwt sync: recalculate tickets index inside a worktree

**Status:** Done
**Priority:** high
**Effort:** Medium

**Summary:**

giwt sync (runSync, src/tickets/sync-index.ts) resolves the tickets dir against the checkout it runs in, but --fix writes and git-issue mutations can target the root checkout state; running sync from tree/`<branch>` must recalculate index.json for that worktree and stay isolated from dev/root.

**Context:**

Requirements:

- runSync resolves INDEX_PATH/LOCK_PATH relative to the invoking worktree root (already parameterized via repoRoot — verify callers pass the worktree root, not the main checkout).
- --fix writes branch-local index.json changes that merge cleanly (atomic temp+rename already in place).
- git-issue lookups are shared refs — ensure reconcile classification is stable whether run from root or worktree (same issue registry, divergent index files).
- plan validate tickets gate (delegates to runSync) must work per-worktree: finalize Step 2 runs gates in the worktree, so this is a correctness prerequisite for gating branch-local ticket changes.
- Tests: run runSync against a fixture linked worktree, assert isolation and fix write location.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
