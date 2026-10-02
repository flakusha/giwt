<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: reach parity with the loop-lore worktree fork so it can be deleted

**Status:** Done

All three giwt-side deltas re-verified landed 2026-10-02: the detached-root
finalize guard (`finalize.ts:1215-1234`), git env isolation (50/50 spawns
isolated; fork 39/39), the rebase default target (`rebase.ts:25` reading
`config.settings.branches.root`), and `commit`/`commit-wt` spreading the
filtered env with only `GIT_COMMITTER_*` re-set (`commit.ts:99`,
`commit-wt.ts:118`). The loop-lore fork deletion is tracked in that repo.
**Priority:** high
**Effort:** Medium
**Tags:** worktree, migration, isolation, history-safety

**Summary:**

loop-lore has decided to delete its in-repo `scripts/worktree/` fork and use giwt.
That is blocked until giwt matches the fork on three points where the fork is
currently AHEAD. Deleting the fork first would regress loop-lore.

**Context:**

## 1. finalize merge target (history safety)

`src/commands/finalize.ts:959` resolves the target via `getRootBranch()`, which
is `git branch --show-current` or a literal `"master"` fallback. On a detached
HEAD the first returns empty, so finalize merges the feature branch into
`"master"` - a branch the operator never named, rewritten in place. Detached
state is transient but real (during a finalize merge dance, or after
`git checkout <sha>`).

loop-lore's fork now resolves the target directly and refuses when detached.
Reproduced by restoring the old fallback: finalize exits 0 and the feature commit
lands on `master`.

## 2. git child env isolation

giwt has `isolatedGitEnv()` and wires it into `gitSync`/`gitSyncQuiet`, but 31 of
39 direct `git` `Bun.spawnSync` call sites still pass no `env`. A `GIT_DIR` or
`GIT_INDEX_FILE` inherited from a git hook or an agent harness redirects those
children despite the explicit `-C <repoRoot>`. The worst cases are the staged-work
prechecks (`commit.ts:41`, `commit-wt.ts:53`, `rebase.ts:52` and `:56`,
`finalize.ts:531`, `:535`, `:1026`, `:1030`), where a poisoned index turns "dirty"
into a false "clean" and finalize proceeds over work it never saw.

loop-lore's fork now has 0 of 40 unisolated spawns, audited mechanically rather
than by eye. `FEAT-ISOLATEDGITENV-ALSO-STRIPS-AGENT-HARNESS-SESSION-VARS` is
marked Done but only ever covered the two helpers.

`commit.ts:101` and `commit-wt.ts:119` additionally forward `...process.env`
wholesale while setting `GIT_COMMITTER_NAME`/`_EMAIL`; the fix is to spread the
filtered env and re-set only the identity the command owns.

## 3. rebase default target

See BUG-rebase-default-target-is-the-root-branch-which-is-also-prote. That
regression blocks rebase parity and must land first.

## Scope

giwt is otherwise ahead - it already has the finalize lock jitter, the
configured-root rebase default, `--gates`/`--skip-gates`/`--plan-gates`,
`credentials.ts`, and `doctor`/`plan`/`runs`/`clean`, which the fork lacks. So
this is a short list, not a large port.

Tracked loop-lore-side by the fork-retirement ticket in the loop-lore repo
(`.plan/tickets/`, not resolvable from here).

**Acceptance Criteria:**

- [x] `finalize` refuses a detached root checkout instead of merging into the
      `getRootBranch` fallback branch — `src/commands/finalize.ts:1215-1234`
- [x] Every `git` `Bun.spawnSync` in `src/` passes an isolated env; verified by
      a mechanical audit, not by eye — 50/50 isolated (re-measured 2026-10-02)
- [x] `commit` and `commit-wt` spread the filtered env and re-set only
      `GIT_COMMITTER_NAME`/`_EMAIL` — `commit.ts:99`, `commit-wt.ts:118`
- [x] The rebase default-target regression is fixed — `rebase.ts:25`
- [ ] loop-lore deletes `scripts/worktree/` and its `docs/giwt-scripts-map.md`
      references, with no loss of behaviour — **owned by the loop-lore repo;
      still present there as of 2026-10-02**
- [x] Tests passing
