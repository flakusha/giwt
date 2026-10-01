<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: reconcile leftover finalize stashes in a temp worktree

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium

**Summary:**

Reconcile leftover `worktree-finalize-*` stash entries inside a fresh temp worktree instead of the repo root, so root stays unblocked. DEFERRED by design review 2026-10-01: finalize's pop-conflict fallback already keeps root clean (reset to post-merge HEAD, stash preserved; finalize.test.ts:1319-1329) and `giwt abort` serves manual recovery — build only when leftover frequency justifies it.

**Context:**

Feasible design if built: the stash ref is repo-global, so a temp worktree spawned at the stash's base commit can apply the entry there, drop it on success, and stay conflicted on failure with the root untouched. Blocking constraint: a claim-once protocol against the two existing FINALIZE_STASH_PREFIX consumers (finalize.ts stashDevForMerge, abort.ts selectFinalizeStashes) — without it, a double-pop race. Untracked files require the -u push variant. Alternatives considered: keeping the manual abort flow (chosen for now).

**Acceptance Criteria:**

- [ ] New command applies a named finalize stash entry inside a temp worktree at its base commit
- [ ] Success drops the entry exactly once; both existing prefix consumers coordinate via the same claim marker
- [ ] Conflict path leaves the worktree conflicted, root untouched, entry preserved
- [ ] USAGE + docs updated; tests cover success, conflict, and double-invocation cases
