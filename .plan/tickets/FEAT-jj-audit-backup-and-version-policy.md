<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj audit backup and version policy

**Status:** In Progress
**Priority:** medium
**Effort:** medium
**Tags:** jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Remaining jj integration from `.tmp/research/jj/OPEN-QUESTIONS.md`: #4 version floor/churn, #15 audit without git patch-id, #16 skip-ledger re-key, #17 ledger outcome summaries, #18 hot-backup scope, #19 installer path.

**Decisions (2026-11-18, user-approved):**

- jj is **colocated-only**, so the backing git store remains the substrate for history audit and backup: audit detectors may use colocated git plumbing (patch-id, rev-list) alongside change IDs + evolog.
- Hot backups **exclude `.jj/` with a loud warning** (the op log is not captured); the git store is what is backed up. Document the gap rather than claiming the op log survives restore.
- Version floor is **jj 0.46** (workstation 0.46.0); pin the installer path and document jj's monthly-breaking-release churn, leaving no GURU-vs-musl ambiguity unresolved.
- The skip ledger is re-keyed on jj change IDs; ledger entries carry outcome summaries for jj verbs.

**Acceptance Criteria:**

- [ ] Audit/history detectors work on a colocated jj repo using change IDs + evolog or colocated git plumbing; tests cover resurrected/rewrite/weave cases.
- [ ] Hot-backup config explicitly excludes `.jj/` and emits a loud warning naming the unbacked-up op log; a test asserts the exclusion and the warning.
- [x] The skip ledger uses change IDs as keys with a test proving re-key-on-change-ID (`history/jj-history.ts`, explicit `commit_id(...)` revset for hidden rewritten commits); ledger entries include jj verb outcome summaries.
- [ ] Version floor 0.46 is enforced with a clear error below it; the pinned installer path and churn policy are documented.
- [x] `bun run check` passes; docs updated; SPDX headers on new files.

**Not in this ticket:** non-colocated repos, finalize/abort op-log rewrite.
