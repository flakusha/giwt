<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize leaves dev worktree stale after merging

**Status:** Done
**Priority:** critical
**Effort:** Medium
**Tags:** finalize, dev-sync, worktree

**Summary:**

`giwt finalize` advances the `dev` ref to the merge commit but never fast-forwards the `dev` working tree. It detects the problem, prints a warning, and then continues anyway, leaving the dev checkout with an index and working tree that describe the PRE-merge tree while the ref sits at the NEW merge commit.

Three things then disagree at once: the `dev` ref / HEAD is AHEAD (post-merge), `.git/index` still describes the PRE-merge tree (so it produces STAGED entries), and the working tree still holds PRE-merge file content (so it produces modified files, and files just landed by the merge are ABSENT from disk).

The stale index is staged in a way that would delete real committed code. A developer or agent who ran a routine commit on the dev checkout to "save" the pending changes would have destroyed the entire just-landed feature.

Observed while finalizing a queue of branches in loop-lore, which consumes giwt as a git dependency. Real observed failure, not hypothetical.

**Context:**

Warning emitted, then the run continues and reports success:

```text
dev checkout not fast-forwarded to dev (dirty working tree) — sync manually
  Then: git -C <repoRoot> merge --ff-only dev
```

Code path: `snapshotDevReadiness` (`src/commands/finalize/staging-sync.ts:28-45`) snapshots dev eligibility BEFORE the CAS ref move — if the checkout is not on the target branch or `git status --porcelain` is non-empty, `syncDevLazily` (`staging-sync.ts:52-79`) takes the warn-and-return-false branch. The caller treats false as informational: the merge already landed, teardown proceeds, the run reports success, exit code 0.

Why this is dangerous, not merely untidy — the stale index is staged to delete code that had just been merged. On one real dev checkout, `git diff --cached --name-status HEAD` showed 76 staged paths including deletions of files merged into `dev` in that same second:

```text
D  src/db/migrations/050_vn_questions.ts
D  src/routes/chats/vn-questions.ts
D  src/chat/service/vn-questions.ts
```

The content survived only because HEAD had already moved. The working state was booby-trapped against the obvious action (committing the pending changes).

The failure compounds: each finalize leaves the dev worktree further behind, so residue accumulates across a finalize queue. Measured across one finalization queue in one session:

- after an early finalize: 29 staged entries, incl. a staged deletion of a committed file
- after the next: 5 staged entries
- after the next: 76 staged paths, incl. a staged deletion of the just-landed migration
- after the next: 26 paths committed at HEAD but MISSING FROM DISK (an entire feature directory tree)
- plus a growing tail of ~80 modified-but-present files

Manual recovery (audit each staged path's on-disk blob against that path's history within HEAD ancestry, confirm zero novel blobs, reset the index with `git reset --mixed HEAD`, then restore absent paths from HEAD with a per-path checkout) took roughly 30-60 minutes of careful work per occurrence. That is not something an operator should have to do as a routine consequence of finalizing branches.

Secondary observations:

- Not atomic: finalize warns but proceeds to report success. No signal beyond one line of warning text in a long output stream; no run-record outcome, no ledger gripe, exit 0.
- A viable fix shape exists — `git reset --mixed HEAD` on the dev checkout clears the index safely (index-only, zero bytes on disk), and explicit per-path `git checkout HEAD -- <paths>` restores absent files without overwriting other modified files — but any fix must first prove there is no genuine uncommitted work, or refuse to land.

Reproduction:

1. In a repo using giwt as a git dependency, leave any local modification (or untracked file) in the root/dev checkout.
2. `giwt new <branch>`, make a commit in the branch worktree.
3. `giwt finalize <branch>` from the root checkout.
4. The merge lands on dev (HEAD moves), the warning above prints, exit code is 0.
5. On the dev checkout, `git diff --cached --name-status HEAD` shows staged entries — including staged deletions of the paths the merge just added; `git status` shows modified files; files the merge added are missing from disk.

Suggested fix directions (not implemented):

- (a) fast-forward the dev working tree when the pre-CAS snapshot proves it safe to do so, or
- (b) refuse to finalize until the dev working tree is clean — exit non-zero with an actionable message, or
- (c) at minimum, after merging, explicitly reset the index and restore any path the merge changed, so the checkout can never be left staged to delete the code that just landed.

The safety property to preserve regardless: never leave the dev checkout in a state where a routine commit destroys committed code.

**Acceptance Criteria:**

- [x] After a finalize against a dirty-but-on-branch dev checkout, `git diff --cached --name-status HEAD` reports no staged entry that the merge itself created
- [x] Before any index write, finalize proves the checkout state from the pre-CAS snapshot; paths carrying genuine user work are never touched (per-path classification against the pre-move HEAD, replacing the interim `reset --mixed HEAD` trade)
- [x] Regression test: dirty dev checkout + finalize asserts no staged deletion of merge-landed paths (verified failing before the fix — `D feature.txt` — and passing after)
- [x] A successful finalize never leaves the dev checkout's **working tree** behind the moved ref: merge residue is restored per path from the moved ref (`checkout HEAD -- <paths>` for added/modified, `git rm -f` for deleted), so merge-landed files are back on disk and merge-deleted files are gone
- [x] When the dev checkout genuinely cannot be synced, finalize does not report success: run-record outcome gate `dev-sync` + non-zero exit (exit hook gripes); teardown is skipped so the worktree + branch survive and a post-cleanup re-run finishes teardown

**Resolution:**

Full fix (supersedes the interim `reset --mixed HEAD` realign, which discarded the staged/unstaged distinction and still reported success). `snapshotDevReadiness` (`finalize/staging-sync.ts`) samples the complete pre-CAS state: HEAD branch, resolved HEAD sha, the dirty-path set (`status --porcelain -z -uall --no-renames`, giwt lock scratch exempt) and a usable-worktree flag. After the CAS, `syncDevLazily` re-verifies the checkout still sits on the target, keeps the verified-lossless `checkout -f` fast path for a clean pre-move state (falling back to the targeted restore when it fails), and otherwise hands to `restoreMovedDevCheckout` (`finalize/dev-restore.ts`): every post-move dirty path is classified as merge residue — in the pre→post merge delta AND byte-identical to the pre-move HEAD — or as genuine uncommitted work (anything else, including mid-merge edits to delta paths). Residue is restored from the moved ref per path; genuine work is never touched and makes finalize refuse loudly. Detached/other-branch checkouts and a missing working tree stay informational, and step 5.5 still only runs when the dev checkout actually synced.

Why the residue classification is sound: a path that was clean at the pre-move HEAD and only appears dirty because HEAD moved away from it has index and worktree bytes that are exactly the pre-move HEAD's bytes — restoring them from the moved ref loses nothing. Paths dirty before the move are genuine by construction; delta paths whose worktree no longer matches the pre-move HEAD were edited mid-merge and are reclassified as genuine. `git rm -f` is required post-CAS (against the moved HEAD every merge-deleted path reads as a staged add, which plain `git rm` refuses) — the classification proof is what makes forcing it safe.
