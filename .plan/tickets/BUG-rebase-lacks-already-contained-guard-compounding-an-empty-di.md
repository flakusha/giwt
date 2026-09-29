<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: rebase lacks already-contained guard, compounding an empty-diff rewrite loop

**Summary:** `rebaseWithPlanReconciliation` invokes `git rebase` with no check for whether the target is already contained in the branch, so a no-op rebase rewrites and re-signs the entire stale tail with byte-identical content.
**Context:** Reported from loop-lore, where repeated `giwt rebase` runs against a ~2400-commit-stale branch compounded duplicate empty-diff commits. Distinct from issue `23751b8`, which covers target *validation* (protected target, self-rebase, default-target derivation) rather than no-op *detection*.
**Acceptance Criteria:** `isAncestorOf` implemented via `git merge-base --is-ancestor`; `rebaseWithPlanReconciliation` short-circuits to `{ exitCode: 0 }` on a contained target; an unknown ref returns `false` rather than success; new `src/commands/rebase.test.ts` covers contained, diverged, and unknown-ref cases plus a HEAD-unchanged integration assertion; `bunx tsc --noEmit` clean and full `bun test` green.

**Status:** Done (shipped: isAncestorOf guard; contained target short-circuits without spawning rebase)
**Priority:** high
**Effort:** Small
**Tags:** git, worktree

## Context

`giwt rebase <branch> [onto]` calls `rebaseWithPlanReconciliation`, which invokes
`git rebase` unconditionally. There is no precondition that detects a target already
contained in the branch, so a rebase against a stale-relative target silently does
harmful work instead of being a no-op. Reported from loop-lore, where repeated runs
against a ~2400-commit-stale branch compounded into duplicate empty-diff commits.

## Summary

Rebasing onto an already-contained target is not a no-op — it rewrites and re-signs
the branch's entire tail with byte-identical content, and each round feeds its own
rewritten SHAs back as the next round's range.

## Defect

`rebaseWithPlanReconciliation` (`src/plan/reconcile-conflicts.ts:214`) runs

```ts
let result = runGit(root, "rebase", target);
```

with no precondition check. When `target` is already an ancestor of the branch's
HEAD, `git rebase <target>` has nothing to replay - but the guard that would
catch this before any work starts is absent, and the failure mode is compounding
rather than immediate.

## Why the absence is worse than a no-op

On a branch that forked long ago, the rebase is entered on an already-contained
target. Git walks the branch's whole tail, skipping already-applied commits, and
lands in a state where the range is the branch's own history. That range then
becomes the input to the *next* rebase round. Each round rewrites and re-signs
every SHA while the tree content stays byte-identical, so each round feeds its own
rewritten SHAs back as the next round's range. Observed in the wild: repeated runs
against a dev checkout that had moved ahead produced duplicate commits with empty
diffs, and the rebase eventually stalled on add/add conflicts in `.plan/tickets/`
(it can auto-resolve only the generated files).

`git rebase` has no native "already up to date, do nothing" exit, so the naive
call is indistinguishable from a real replay until the damage is done.

## Fix

Add a precondition using `git merge-base --is-ancestor <target> HEAD`, evaluated
before the rebase starts. If the target is already contained, log and return
`{ exitCode: 0, ... }` without invoking rebase at all.

Shape:

```ts
export function isAncestorOf(root: string, ancestor: string, descendant: string): boolean {
  const r = runGit(root, "merge-base", "--is-ancestor", ancestor, descendant);
  return r.exitCode === 0;
}
```

`merge-base --is-ancestor` exits 1 for "not an ancestor" and 128 for a bad ref, so
an unknown ref must not be treated as a no-op rebase - return `false` and let the
existing flow surface the error, rather than silently claiming success.

Three cases, all of which are real:

1. `target` contained in branch HEAD -> the no-op rebase that starts the loop;
   must short-circuit to success.
2. branches genuinely diverged -> a real move; the guard must NOT block it.
3. unknown ref -> must not report success.

## Tests

`src/commands/rebase.test.ts` does not exist; this needs a new colocated test
building a tiny real git history (the pattern already used in
`src/resolve-diff-base.test.ts` and `src/commands/finalize.test.ts` - a temp repo
with `git init`, synthetic commits, and `rmSync` in `finally`).

Assert `isAncestorOf` directly for the three cases above, plus one integration
assertion that `rebaseWithPlanReconciliation` on a contained target leaves the
HEAD SHA unchanged and performs no rewrite.

## Origin

Reported from loop-lore, where `giwt rebase` on a ~2400-commit-stale branch
produced the duplicate/empty-diff loop described above. loop-lore keeps a forked
copy at `scripts/worktree/commands/rebase.ts` with the same gap, so this fix
protects both until the fork is retired.

## Relationship to 23751b8

Distinct defect, same function. `BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re`
(issue `23751b8`) covers *target validation*: refusing a protected target, refusing
self-rebase, and deriving the default target from `config.settings.branches.root`
rather than a possibly-detached main checkout.

This ticket covers *no-op detection*: when the target is a valid, unprotected,
already-contained ref, the rebase is still not a no-op. Both guards are needed and
neither subsumes the other — `23751b8` would refuse bad targets, this one declines
harmless ones. Both also want a `src/commands/rebase.test.ts`, which does not exist;
the second one to land should extend rather than duplicate the first's fixture.

`23751b8` also observes that `src/commands/rebase.ts` is the only command under
`src/commands/` with no `*.test.ts` sibling. That is confirmed here and is why the
test file is called out as a deliverable.

## Acceptance Criteria

- [x] `isAncestorOf` implemented via `git merge-base --is-ancestor`
- [x] `rebaseWithPlanReconciliation` short-circuits to `{ exitCode: 0 }` without invoking rebase when the target is already contained
      invoking rebase when the target is already contained
- [x] An unknown ref returns `false` rather than reporting success
- [x] New `src/commands/rebase.test.ts` covers: contained target (no-op), diverged branches (real move still allowed), unknown ref
      branches (real move still allowed), unknown ref
- [x] Integration assertion that a contained-target rebase leaves HEAD unchanged
- [x] `bunx tsc --noEmit` clean and full `bun test` green

git issue: 8dc674e
