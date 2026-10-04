<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: universal post-merge plan reconciliation

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** plan, finalize

**Summary:**

Run reconcileScopedPlan for every non-alreadyMerged finalize, not only scoped worktrees. Fixes index drift; does not relieve rebase-time scalar conflicts.

**Context:**

run.ts:209-212 runs reconcileScopedPlan only when scopedMeta is not null. Non-scoped branches merge index.json drift that nobody repairs until the next scoped run lands. Drop the scopedMeta condition so every non-alreadyMerged finalize reconciles (rename to reconcilePlanPostMerge while touching it). Explicitly NOT a fix for rebase-time scalar conflicts: json-merge.ts:74-76 keeps ours (the replayed side) on competing scalars - pinned by reconcile-conflicts.test.ts:291-305 - and a post-merge runSync --fix cannot distinguish a conflict-default from a deliberate edit. That half needs the index-shard ticket.

**Acceptance Criteria:**

- [x] Every non-alreadyMerged finalize runs plan reconciliation with commit-if-dirty
- [x] alreadyMerged path unchanged (no empty commit)
- [x] Idempotent rerun skips the commit
- [x] Tests cover scoped and non-scoped paths
**Resolved:** 2026-10-04T01:42:42.910Z Landed: Step 5.5 universal; commit subject now chore(plan): post-merge reconciliation
