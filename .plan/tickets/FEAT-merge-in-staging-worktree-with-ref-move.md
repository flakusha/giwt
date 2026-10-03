<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: merge in staging worktree with ref move

**Status:** Not Started
**Priority:** high
**Effort:** Large
**Tags:** staging, finalize

**Summary:**

New finalize/staging.ts: worktree add detached at target, merge there, update-ref CAS move, lazy dev sync, prune staging. Add --onto flag defaulting to settings root.

**Context:**

Today the merge runs in the dev checkout: stashDevForMerge (3 call sites at merge-exec.ts:76,154,199) + merge + restoreDevFromStash + signal rollback via state.ts. A kill -9 mid-merge leaves dev mid-merge; stash-pop conflicts land on the reset path. Replace with: (1) steps 1-4 unchanged in the source wtPath, outside the lock; (2) acquire lock with the narrowed scope from the lock-narrow ticket; (3) git worktree add --detach tree/.finalize-BRANCH-PID at the target ref; (4) rebase-with-reconciliation plus merge --ff-only / --squash / --no-ff with the repoRoot parameter retargeted at the staging path, universal step 5.5 regen here; (5) atomic git update-ref refs/heads/TARGET NEWSHA OLDSHA - a concurrent mover fails instead of corrupting (policy-clean: update-ref is allowed in policy-tables.ts:91 and deleteBlocker only fires on -d/--delete); (6) release lock, run existing teardown on the source WT + branch; (7) lazy dev sync out of band - clean tree fast-forwards, dirty/detached warns and stays, never auto-stash; (8) remove the staging WT with the teardown helper. A kill -9 then leaves a staging dir plus an unmoved ref; giwt abort prunes it and dev is never mid-merge. The --onto flag (default settings.branches.root) gives worktree-to-worktree finalize for free: neither working tree is touched, both fast-forward lazily when clean. The detached-dev refusal at finalize.ts:116-130 downgrades to a warning only after lazy-sync ships - not before.

**Acceptance Criteria:**

- [ ] Merge executes in an ephemeral staging worktree; the dev checkout never sees MERGE_HEAD
- [ ] update-ref carries the old-SHA expectation; a concurrent mover fails cleanly
- [ ] --onto accepts any ref and defaults to the settings root
- [ ] Lazy dev sync: clean tree fast-forwards, dirty/detached warns and stays
- [ ] abort prunes an orphan staging worktree; no stash helpers on the new path
- [ ] Tests: happy path, CAS contention, simulated-kill orphan, dirty-dev warning
