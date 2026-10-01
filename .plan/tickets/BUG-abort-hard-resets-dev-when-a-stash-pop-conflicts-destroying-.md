<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: abort hard-resets dev when a stash pop conflicts, destroying other sessions' tracked work

**Status:** Done (fixed 2026-10-02: conflict path stops recovery, never resets, exits 1; selection anchored; regression tests in src/commands/abort.test.ts)
**Priority:** high
**Effort:** Small
**Tags:** abort, stash, git, history-safety

**Summary:** On a non-zero `stash pop` exit, `abort()` runs an unconditional hard reset inside `repoRoot`, which is the shared dev checkout, destroying other live sessions' uncommitted tracked work; the branch then continues the loop instead of stopping and still reports `Abort complete` with exit 0.
**Context:** Confirmed live in giwt source: `loop-lore/node_modules/giwt/src/commands/abort.ts` and `giwt/src/commands/abort.ts` are byte-identical (`diff` reports no difference). Compounding defect: `refs/stash` is repo-global, not per-worktree, so a conflict in one worktree's dev checkout can discard tracked edits belonging to any other session sharing that repo.

## Summary

On a non-zero `stash pop` exit, `abort()` (`src/commands/abort.ts:243-252`) runs a hard `reset --hard HEAD` inside `repoRoot`. For this project `repoRoot` is the shared dev checkout, so this destroys OTHER live sessions' uncommitted work. The branch then `continue`s the loop instead of stopping, so one conflict silently escalates into further pops against a tree it just hard-reset.

## The code

```ts
log("warn", `${entry.ref} pop conflicted — preserving stash, cleaning tree`);
const head = gitSyncQuiet(repoRoot, "rev-parse", "HEAD");
const reset = Bun.spawnSync(
  ["git", "-C", repoRoot, "reset", "--hard", head],
  { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
);
```

(`abort.ts:243-252`)

`reset --hard HEAD` discards every uncommitted TRACKED modification and every staged-but-uncommitted change in that checkout. It is unconditional: it runs on any non-zero pop exit, including a plain "local changes would be overwritten by merge" refusal, with no confirmation and no scoping to the stash's own paths.

## Verified impact

Scratch repo, tracked edit created AFTER all stashes so nothing protects it, then the verbatim loop from `abort.ts:232-253`:

```text
worktree before:     M base.txt
                    ?? live-wip.txt
VERDICT: *** other session's tracked edit DESTROYED by reset --hard ***
untracked file: survived (reset --hard does not touch untracked)
```

Scope limit, measured: destructive to TRACKED modifications and staged content; untracked files survive.

This directly contradicts the sibling finalize path, which scopes the same idea: `restoreDevFromStash` (`finalize.ts:840-844`) resets to the captured post-merge `mergeHead` and is invoked as part of a documented transactional restore, and `finalize.test.ts:1319-1329` pins "rolls dev back to HEAD when the stash pop conflicts". `abort` has no transaction around it -- it is a standalone manual-recovery command.

## Secondary defect on the same branch: it does not stop

After the reset, the loop falls through to the next iteration. There is no `break`, no error propagation, and `abort()` goes on to report `Abort complete` (`abort.ts:287`) with exit 0. So one conflict silently cascades: the tree is hard-reset mid-loop, and the remaining stashes are then popped onto that freshly-reset tree -- which is exactly the state that makes the NEXT pop likely to fail too, or to succeed and re-apply content the operator never asked for.

Note the tension with the branch's own warning text. "preserving stash, cleaning tree" describes the stash accurately but implies the cleanup is benign. The stash is preserved; the operator's other uncommitted work is not, and the run still claims success.

## Fix direction

- Leave the tree alone on conflict and surface it. The stash is already preserved by the failed pop; the honest recovery is to report the conflicted paths and stop so the operator decides.
- Or scope the cleanup to the stash's own paths (`checkout -- <paths from stash>`), so unrelated tracked edits are untouched.
- At minimum, break out of the loop after a failed pop instead of continuing, and exit non-zero so the operator is not told "Abort complete".

Whichever is chosen, a hard `reset --hard` in a shared checkout should not be silent. `finalize.ts:846-855` already models the alternative: on unrecoverable reset failure it prints explicit manual-recovery commands rather than mutating silently.

## Test gap

`abort.test.ts:256-273` already holds the index lock so both the pop and the reset fail, and asserts only that the stash survives. It never asserts what happens to the working tree, so `reset --hard` running at all -- and the loop continuing afterwards -- goes unnoticed. `abort.test.ts:167-187` asserts the success path where no reset happens.

The conflict branch is reachable only through a real subprocess pop against a real dirty tree, so it cannot be driven by the exported pure helpers (`parseStashList`, `selectFinalizeStashes`, `scanLockfile`, `removeLockfile`) that `finalize-signal-safety.test.ts:157-190` unit-tests against canned output. A regression test needs a scratch repo whose working tree carries an unrelated tracked modification that is NOT part of the stash, then asserts that modification survives `abort` and that the command does not claim success while a conflict occurred.

## Acceptance Criteria

- [x] A failed `stash pop` in `abort()` leaves unrelated uncommitted TRACKED work in `repoRoot` intact
- [x] Conflict path stops the recovery loop instead of popping remaining stashes onto a just-reset tree
- [x] Conflict path exits non-zero and does not print `Abort complete`
- [x] Warning text matches actual behavior (either stops touching the tree, or says explicitly which work it discards)
- [x] Regression test in `abort.test.ts`: real scratch repo, dirty unrelated tracked file plus a stashed finalize entry, asserts the tracked file survives and the exit code is non-zero
- [x] `bunx tsc --noEmit` clean and full `bun test` green
