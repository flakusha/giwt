<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: abort pops stashes by positional ref, destroying user-authored stashes

**Status:** Done (fixed 2026-10-02: pops ordered highest-index-first plus per-pop label re-resolution; interleaved regression test in src/commands/abort.test.ts)
**Priority:** critical
**Effort:** Small
**Tags:** abort, stash, git, history-safety

**Summary:** `abort()` selects leftover finalize stashes by message but pops them by the positional ref `stash@{N}` captured during the scan; each successful pop renumbers lower indices, so with 2+ finalize stashes the loop pops and destroys user-authored stashes while skipping the finalize stash it meant to restore. Reported from loop-lore, whose live stack had 2 finalize + 2 user entries interleaved.
**Context:** Confirmed live in giwt source: `loop-lore/node_modules/giwt/src/commands/abort.ts` and `giwt/src/commands/abort.ts` are byte-identical (`diff` reports no difference), so the published copy carries the same defect. Distinct from `FEAT-reconcile-leftover-finalize-stashes-in-a-temp-worktree` (a deferred feature for reconciling leftovers, not a correctness bug) and from `FIX-abort-leaves-stale-rebase-head-and-finalize-is-blocked-by-th` (orphan marker cleanup only).

## Summary

`abort()` (`src/commands/abort.ts:225-253`) selects leftover finalize stashes by message, then pops them by the POSITIONAL ref `stash@{N}` captured during the scan. A successful `stash pop` removes the entry and RENUMBERS every lower index, so after the first successful pop every remaining captured ref points at a DIFFERENT stash than the one that was selected.

With 2+ `worktree-finalize-*` entries on the stack, `giwt abort` therefore pops -- and DESTROYS -- user-authored stashes, while simultaneously SKIPPING the finalize stash it intended to restore. This contradicts the module's own documented guarantee (`abort.ts:25-26`: "Never deletes user-authored stashes. We only touch entries whose message contains `worktree-finalize-`") and the consumer-facing AGENTS.md promise that abort "NEVER deletes user-authored stashes".

## Mechanism

- `parseStashList` (`abort.ts:152-163`) splits each list line on the first colon and returns `{ ref: "stash@{N}", message }`. The ref is positional and is never re-resolved.
- `selectFinalizeStashes` (`abort.ts:170-172`) filters on `e.message.includes(FINALIZE_STASH_PREFIX)`. Selection is CORRECT at scan time.
- `abort()` (`abort.ts:232-253`) then loops the captured entries in list order and runs `stash pop <entry.ref>`. The defect is re-resolving the ref at pop time, not the selection.
- Renumbering is inherent to `refs/stash` reflog semantics, not a git bug: indices are positions in the reflog, so removing entry 0 shifts every later entry down by one.

Contrast `restoreDevFromStash` in `finalize.ts:812-823`, which is immune: it re-reads the list and matches on a UNIQUE label before splitting the ref, so it never acts on a stale index.

## Verified reproduction

Run against a scratch repo whose stack exactly matches loop-lore dev's live stack (`{0} worktree-finalize-mup06244 | {1} USER 2105656f1 fix(frontend) | {2} worktree-finalize-muo8vg34 | {3} USER 17d5094b2 style(gate-timeout)`), one file per stash so no pop conflicts and ordering is the only variable. Selected refs computed exactly as `abort.ts` does:

```text
selected by abort.ts logic: stash@{0} stash@{2}
pop stash@{0} OK
pop stash@{2} OK
finalize-mup06244 remaining: 0 (want 0)
finalize-muo8vg34 remaining: 1 (want 0)   <-- SKIPPED, never restored
USER 2105656f1 remaining:    1 (want 1)
USER 17d5094b2 remaining:    0 (want 1)   <-- DESTROYED
```

Trace: pop 1 targets `stash@{0}` = finalize-mup06244 (correct, dropped). Pop 2 still says `stash@{2}`, but after the first pop the stack is renumbered so `stash@{2}` now resolves to USER 17d5094b2 -- which is popped AND applied, destroying it. Net: one user stash destroyed, one finalize stash never restored.

## Amplifier: refs/stash is repo-global

`refs/stash` is a single repo-wide ref, NOT per-worktree. Verified by running the list command from four separate checkouts in a 22-worktree repo (dev root plus three `tree/*` worktrees) -- byte-identical 4-entry output from all four. Consequences:

- Any worktree's `giwt abort` can pop and destroy another worktree's user stash.
- A drop issued from any worktree is repo-global; running from `tree/X` does not scope it.
- This also widens the concurrency window: another agent pushing a stash between the scan and the pop changes what the stale ref resolves to.

## Fix direction (verified)

Popping the captured refs in DESCENDING index order is correct, because removing a higher index never renumbers a lower one. Verified on the same fixture:

```text
pop order (reversed): stash@{2} stash@{0}
finalize-mup06244 remaining: 0 (want 0)
finalize-muo8vg34 remaining: 0 (want 0)
USER 2105656f1 remaining:    1 (want 1)
USER 17d5094b2 remaining:    1 (want 1)
```

All four expectations met; both finalize entries restored, both user entries intact. Cheapest correct fix: sort the selected refs by descending numeric index before the loop. Equivalent alternative: re-scan and re-resolve by label/message before each pop, as `finalize.ts:812-823` already does.

NOTE on a tempting non-fix: operating by SHA does NOT work for drop. `stash pop <sha>` and `stash drop <sha>` both fail with `error: '<sha>' is not a stash reference` (git 2.55.0, verified). `stash apply <sha>` DOES accept a SHA and exits 0, but apply does not remove the entry, so it cannot replace the pop without a separate unverified drop step. Do not propose pop-by-SHA.

## Test gap

`parseStashList` and `selectFinalizeStashes` are exported specifically so tests can drive them against canned output without spawning git (`abort.ts:141-146`, `abort.ts:165-169`) -- and `finalize-signal-safety.test.ts:157-190` does exactly that. But the defect lives in the subprocess loop at `abort.ts:232-253`, which those pure helpers cannot reach, so no canned-text test can reproduce ref renumbering: renumbering is a property of real `refs/stash` mutation across successive pops.

Existing coverage in `abort.test.ts` misses it for two independent reasons:

- `abort.test.ts:189-202` is named "leaves user-authored stashes untouched" but creates ONE user stash and ZERO finalize stashes, so `finalizeStashes.length === 0` takes the early return at `abort.ts:228-229` and the loop never executes. The assertion exercises the no-op branch, not preservation.
- `abort.test.ts:167-187` does exercise the loop, but with exactly ONE finalize stash -- a single iteration, so no renumbering occurs.

A regression test must use a real scratch git repo with 2+ finalize stashes INTERLEAVED with user stashes (assert both user messages still present after `abort`), giving each stash a distinct file so a pop conflict cannot mask an ordering error. Renumbering cannot be reproduced against canned text.

## Acceptance Criteria

- [x] `abort()` restores every selected finalize stash and leaves every non-matching user stash on the stack, with 2+ finalize stashes interleaved with user stashes
- [x] Ordering fix verified: descending-index pop, or per-iteration label re-resolution
- [x] Regression test in `abort.test.ts`: real scratch repo, >=2 finalize + >=2 user stashes interleaved, distinct file per stash, asserts both user messages survive and both finalize entries are consumed
- [x] Existing `abort.test.ts` cases still pass
- [x] `bunx tsc --noEmit` clean and full `bun test` green
