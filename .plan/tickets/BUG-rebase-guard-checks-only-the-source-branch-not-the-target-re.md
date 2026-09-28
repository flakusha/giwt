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

## Verification of the landed migration renumber (2026-09-28)

The 022/023 renumber this ticket's sibling work enabled was landed via cherry-pick as `be08895c4`. Its safety rests on the same `assertMigrationsNotStale` path this bug is adjacent to:

- `migrations - ordering` gate PASSED (24 files, 24 unique prefixes, duplicate `021` resolved)
- `db - schema gate` PASSED, `typecheck - backend` PASSED
- `migrations.test.ts` + `migration-roundtrip.test.ts`: 94 pass / 0 fail, including `passes on a fresh database without a kysely_migration table`
- Both live loop-lore databases (`loop-lore-data/loop-lore.db`, `data/loop-lore.db`) were queried directly: neither has the workflow migrations in `kysely_migration`, so no `kysely_migration` row is orphaned by the rename
- No dangling references to the old filenames anywhere in `src/`, `tests/`, `scripts/`, `docs/`

## Acceptance Criteria

- [ ] `rebase.ts` refuses when the **target** is protected (`cannot rebase onto protected branch`), not just the source
- [ ] `rebase.ts` refuses when `target === branch` (self-rebase)
- [ ] Default target comes from `config.settings.branches.root`, not `getRootBranch(repoRoot)`; a detached main checkout no longer falls back to `master`
- [ ] Every refusal happens **before** any git mutation
- [ ] `src/commands/rebase.test.ts` exists, covering both refusals plus a happy path
- [ ] Regression test fails against the current code
- [ ] `bun test src/commands/` green

git issue: 23751b8
