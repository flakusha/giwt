<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: scoped worktree creation: new --scope and --tickets flags

**Status:** Done
**Priority:** Medium
**Effort:** Large

**Summary:**

`giwt new` gains `--scope <short explanation>` and `--tickets <csv>`. Resolved tickets land in the worktree's first commit with Status rewritten to In Progress; master-side copies stay untouched (copy semantics — probed convergent through mergeIndexRecords 3-way, probe S1–S3; move semantics silently drops Done entries, S5). `ticket close` runs pre-merge; finalize gains a post-merge Step 5.5: runSync --fix + generated-plan regenerate + GPG-signed in-place commit (finalize currently ends at remove-worktree/delete-branch, finalize.ts:1589-1624). Scope text persists as a `**Scope:**` header line in the first 30-line field region.

**Context:**

Design review 2026-10-01. Index merge-up on the fly already exists for rebase/squash (`reconcile-conflicts.ts:171,252`); `In Progress` is sync-gate-clean (`sync-ticket.ts:361` guards statusMismatches to closed-git cases); default finalize check gate carries no plan gates, so "no gate blocking" holds without `--plan-gates`. Constraint: mid-flight master-side edits to the same ticket .md are NOT auto-resolved (reconcile set = generated files only, `reconcile-conflicts.ts:195-202`) and block Step 5a — document the manual path (`ticket 3way`). Status rewrites must go through `vocabStatusTarget` (regression 68d7acc). Alternatives considered: move semantics (rejected — probe S5 shows silent index-entry loss unless post-merge sync exists); master-side In Progress writes (rejected — root contention).

**Acceptance Criteria:**

- [x] `giwt new --scope --tickets` creates worktree + first commit with In Progress status lines and `**Scope:**` header lines (create.ts + new-branch.ts; unknown-id/empty-csv refuse pre-mutation)
- [x] `ticket close` of scoped tickets runs pre-merge when finalize sees the scope marker (finalize `closeScopedIssues`, extid→hash via resolver, idempotent)
- [x] Finalize Step 5.5 performs runSync --fix + matrix/code-map regeneration + signed in-place commit on the target branch (reconcileScopedPlan; commits only when the fix pass landed changes)
- [x] USAGE table updated for `new`; flags parsed before the positional body (parseScopeFlags)
- [x] Tests: scoped-worktree.test.ts — create→status/scope assertions→marker→finalize reconcile helpers, plus unknown-ticket-id and empty-csv negatives (12 cases)
**Resolved:** 2026-10-02T01:30:53.582Z scoped worktree feature landed: new --scope/--tickets, finalize pre-merge close + Step 5.5 reconciliation; 12 fixture tests
