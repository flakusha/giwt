<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: rebase guard checks only the source branch, not the target - rebasing dev onto feature tips rewrote protected history 51x

**Status:** ⬜ Not Started
**Priority:** high
**Effort:** Medium

## Summary

The protected-branch guard in src/commands/rebase.ts:22 runs isProtected(branch) but never checks the target. Two concrete failure paths, both observed in loop-lore.

1) Rebase onto a protected branch is unguarded. `giwt rebase FEATURE dev` rebases onto protected `dev` without refusal.

2) The default target is derived from the MAIN CHECKOUT, not from config. rebase.ts:14 computes target = onto || getRootBranch(config.repoRoot), and getRootBranch (src/utils/git.ts:45) is 'git branch --show-current' of the repo root || 'master'. When the main checkout is detached, it falls back to 'master' - an unrelated or absent target.

**Tags:** rebase, git, history-safety

## Impact

loop-lore `dev@{0..50}` shows 51 `rebase (finish): refs/heads/dev onto <sha>` reflog entries, where the `<sha>` values are feature-branch tips: 4bfb050cc (on `actor-autonomy-story-drive`), 5329e48a4 and c51b9bb062 (on `adopt-orphan-tickets`). Rebasing a branch onto a non-ancestor rewrites its history, so already-merged work is silently dropped - this orphaned two commits on 2026-09-28.

`src/commands/rebase.ts` is also the only command under `src/commands/` with no `*.test.ts` sibling, so neither path had coverage.

The alternative reconciliation (rebase the change, not the branch: cherry-pick onto current `dev`) is what actually landed the 022/023 migration renumber, avoiding a 13-file add/add conflict in `.plan/tickets/`.

## Acceptance Criteria

- [ ] `rebase.ts` refuses when the **target** is protected (`cannot rebase onto protected branch`), not just the source
- [ ] `rebase.ts` refuses when `target === branch` (self-rebase)
- [ ] Default target comes from `config.settings.branches.root`, not `getRootBranch(repoRoot)`; a detached main checkout no longer falls back to `master`
- [ ] Every refusal happens **before** any git mutation
- [ ] `src/commands/rebase.test.ts` exists, covering both refusals plus a happy path
- [ ] Regression test fails against the current code
- [ ] `bun test src/commands/` green

git issue: 23751b8
