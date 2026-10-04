<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: shard tickets index or stop per-branch index commits

**Status:** Done
**Priority:** medium
**Effort:** Large
**Tags:** plan, index

**Summary:**

index.json conflicts on every branch pair that touches tickets; rebase-time scalar defaults destroy intent. Either shard the index or stop committing per-branch index updates and regen post-merge.

**Context:**

The ticket index (1.4 MB in loop-lore, 49 KB here) conflicts on every branch pair that touches tickets. Rebase-time mergeIndexRecords keeps ours on competing scalars, so intent is destroyed before post-merge regen can see it (verified 2026-10-03; reconcile-conflicts.test.ts:291-305 pins ours-wins). Two options: (a) shard the index - one file per ticket or per letter-bucket - so branches touch disjoint paths; (b) stop committing per-branch index updates - ignore the index in worktrees and regen unconditionally in step 5.5 post-merge. Option (b) is cheaper; (a) keeps the index reviewable per branch. Measure the conflict rate before and after.

**Acceptance Criteria:**

- [x] Decision recorded: shard vs regen-only, with the measured conflict rate
- [x] Rebase-time index conflicts drop to near zero on plan-only branches
- [x] No silent scalar-default data-loss path remains
- [x] sync --fix and plan validate green on the chosen shape
**Resolved:** 2026-10-04T02:19:27.826Z Resolved direction 2 (stop per-branch index commits): fix-mode runSync skips the index.json write in linked worktrees (persistIndexCanonical + isLinkedWorktree); target branch stays canonical via post-merge reconciliation + rebase-conflict index merge; readTicketIndex degrades to {} on missing index; main-checkout writes byte-identical
