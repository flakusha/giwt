<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: rebase refuses a dirty worktree with no escape hatch

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** rebase, worktree, dx

**Summary:**
`giwt rebase <branch>` hard-refuses when the target worktree has uncommitted
changes (`src/commands/rebase.ts:85-88`) and offers no autostash, no force flag,
no worktree-less rebase, and not even a remedy line in the error. The rebase is
blocked until the operator commits or discards work that may be deliberately
uncommitted.

**Context:**

Reported from loop-lore, observed verbatim during a real rebase.

## Observed, verbatim

```text
error: uncommitted changes in worktree 'fix-close-stale-tickets'
```

That was the entire output. Exit code 1; no git mutation attempted.

## Situation behind it

- The branch was 79 commits behind `dev` and genuinely needed the rebase — the
  refusal blocked real, necessary work.
- The worktree was dirty because one ticket file was intentionally being left
  uncommitted: it carried an unverified claim that the agent had deliberately
  not staged. Committing it would have asserted a claim not yet checked;
  discarding it would have destroyed the work.
- Neither is acceptable, so the operator was forced into a third option: leave
  the file where it is and do the rebase later, or stage the claim after
  verifying it — i.e. reordering the actual work around a tooling limitation.

## The defect

`src/commands/rebase.ts:74-88`:

```ts
// Check worktree clean
const dirty = Bun.spawnSync(["git", "-C", wtPath, "diff", "--quiet"], { /* … */ });
const staged = Bun.spawnSync(["git", "-C", wtPath, "diff", "--cached", "--quiet"], { /* … */ });
if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
  log("error", `uncommitted changes in worktree '${branch}'`);
  process.exit(1);
}
```

Three gaps, in increasing severity:

1. **No escape hatch.** Unlike git's own `rebase --autostash`, there is no flag
   that stashes, rebases, and restores. The only ways forward are to commit or
   to discard — both of which the caller may be unable to justify.
2. **No remedy in the message.** The sibling guards in this codebase print one:
   `finalize/clean-state.ts:37-39` prints both a commit and a stash remedy,
   `remove.ts:71-72` prints `cd <wt> && git stash`, and `commit-wt.ts:79` prints
   a staging hint. This one names the problem and stops. It is a direct
   regression against the convention set by `FIX-errors-carry-no-remedy`
   ("every user-facing error string names at least one actionable next step").
3. **Untracked files are not probed at all.** The guard runs only `diff
   --quiet` and `diff --cached --quiet`, both of which ignore untracked files
   entirely. finalize probes them explicitly for exactly this reason
   (`finalize/clean-state.ts:42-45`: untracked files are invisible to
   `git diff` but `worktree remove --force` deletes them all the same). Here
   the asymmetry cuts the other way — an untracked file cannot block the
   rebase, so a rebase can land while an untracked `.plan/tickets/*.md` sits in
   the worktree unexamined.

## Suggested fix direction

- At minimum, print the remedy: name the worktree path, and give the two
  commands that clear the block (`cd <wtPath> && git stash` and the commit
  form). This is a one-line change that satisfies the existing
  `FIX-errors-carry-no-remedy` convention and is the smallest thing that fixes
  the observed pain.
- Then consider a `--autostash` flag that passes git's own autostash through, so
  a deliberately-uncommitted file survives the rebase. `rebaseWithPlanReconciliation`
  already owns the `git rebase` invocation, so the flag threads through one call
  site.
- Alternatively, rebase a detached staging worktree (the pattern
  `FEAT-merge-in-staging-worktree-with-ref-move` already introduced for merge),
  which sidesteps the dirty-source problem entirely and reuses shipped code.

## Reproduction

Dirty a tracked file in a worktree that has a registered branch, then run
`giwt rebase <branch>` from the repo root. It exits 1 with only
`uncommitted changes in worktree '<branch>'`.

**Acceptance Criteria:**

- [x] The refusal message names the worktree path and at least one actionable next step
      (consistent with `FIX-errors-carry-no-remedy` and the `finalize`/`remove` guards)
- [x] A decision is recorded on autostash: either a `--autostash` flag that
      stashes/rebases/restores, or a documented rationale for not having one
- [x] `src/cli-usage.ts` USAGE for `rebase` documents any new flag
- [x] Test coverage for the dirty-tree refusal message content in `src/commands/rebase.test.ts`
- [x] `bunx tsc --noEmit` clean and full `bun test` green
**Resolved:** 2026-10-04T13:26:32.263Z fixed in a270701: remedy lines + --autostash; untracked files left untouched (documented)
