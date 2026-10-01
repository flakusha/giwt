<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: scoped worktree creation: new --scope and --tickets flags

**Status:** Not Started
**Priority:** Medium
**Effort:** Large

**Summary:**

`giwt new` gains `--scope <short explanation>` and `--tickets <csv>`. Resolved tickets land in the worktree's first commit with Status rewritten to In Progress; master-side copies stay untouched (copy semantics — probed convergent through mergeIndexRecords 3-way, probe S1–S3; move semantics silently drops Done entries, S5). `ticket close` runs pre-merge; finalize gains a post-merge Step 5.5: runSync --fix + generated-plan regenerate + GPG-signed in-place commit (finalize currently ends at remove-worktree/delete-branch, finalize.ts:1589-1624). Scope text persists as a `**Scope:**` header line in the first 30-line field region.

**Context:**

Design review 2026-10-01. Index merge-up on the fly already exists for rebase/squash (`reconcile-conflicts.ts:171,252`); `In Progress` is sync-gate-clean (`sync-ticket.ts:361` guards statusMismatches to closed-git cases); default finalize check gate carries no plan gates, so "no gate blocking" holds without `--plan-gates`. Constraint: mid-flight master-side edits to the same ticket .md are NOT auto-resolved (reconcile set = generated files only, `reconcile-conflicts.ts:195-202`) and block Step 5a — document the manual path (`ticket 3way`). Status rewrites must go through `vocabStatusTarget` (regression 68d7acc). Alternatives considered: move semantics (rejected — probe S5 shows silent index-entry loss unless post-merge sync exists); master-side In Progress writes (rejected — root contention).

**Acceptance Criteria:**

- [ ] `giwt new --scope --tickets` creates worktree + first commit with In Progress status lines and `**Scope:**` header lines
- [ ] `ticket close` invoked pre-merge when finalize runs with the scoped-worktree metadata
- [ ] Finalize Step 5.5 performs runSync --fix + regenerate + signed in-place commit on the target branch
- [ ] USAGE table updated for `new`; flags parsed before the positional body
- [ ] Tests: fixture covers create → status assertions → finalize → merged index/closure, plus unknown-ticket-id and empty-csv negatives
