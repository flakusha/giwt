<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: giwt remove cannot delete a branch whose worktree is already gone

**Status:** Not Started
**Priority:** medium
**Effort:** Small

**Summary:**

`giwt remove <branch>` only deletes a worktree directory. Once the worktree is
already gone, the branch it pointed at survives with no way to delete it
through giwt - the agent is left reaching for raw `git branch -D`, which the
loop-lore `bashInterceptor` blocks by design.

**Context:**

Evidence (2026-10-01, loop-lore, branch `size-gate-fixes`):

1. `giwt remove size-gate-fixes` -> `error: no worktree found for branch
   'size-gate-fixes' - create it first: giwt create size-gate-fixes`. The
   worktree had already been removed in an earlier step, so `create` is not a
   valid recovery - it recreates a worktree just to delete it again.
2. The branch is real and unmerged (161 files, none of them on dev).
   `git branch -d` is refused by git ("not fully merged"); `git branch -D` is
   blocked by the agent guard, which cannot consume a user approval, so the
   agent is stuck with no in-tooling path forward.

The gap is that `remove` has no branch-only mode. `finalize.ts:1590-1599`
already does the correct two-step (`branch -d`, then `branch -D` once merged),
but that logic is reachable only through a full finalize.

`src/commands/remove.ts:21-37` is the exact branch point: when
`hasWorktreeDir(wtPath)` is false and no stale registration exists, it errors
out. A `--branch-only` mode belongs there.

**Acceptance:**

- `giwt remove <branch> --branch-only` deletes the branch when no worktree
  exists, without requiring one to exist.
- Unmerged branches require an explicit `--force`, and the command prints the
  recovery SHA so the commit stays recoverable from reflog.
- Default behaviour on an unmerged branch is to refuse, printing the SHA and
  the exact recovery command - mirroring finalize's refuse-then-upgrade flow.
- Default behaviour without `--branch-only` is unchanged: worktree removal only.
- The worktree-present path may also delete the branch post-removal when the
  branch is merged, since that is the common leftover after `giwt remove`.
- Test in a scratch repo (mkdtemp): branch with no worktree, merged and
  unmerged; assert refuse-then-force and that the SHA is reported.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated

git issue: 4368e0c
