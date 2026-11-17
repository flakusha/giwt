<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj audit backup and version policy

**Status:** Not Started
**Priority:** medium
**Effort:** medium
**Tags:** jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Remaining jj integration work from .tmp/research/jj/OPEN-QUESTIONS.md: #4 version floor and churn policy (jj monthly breaking releases; workstation has 0.46.0, latest at research time 0.47.1); #15 history audit detectors without git patch-id (change IDs + evolog or colocated git plumbing); #16 skip ledger re-keyed on change IDs; #17 ledger outcome summaries for jj verbs; #18 whether .jj/ joins [backup] targets so the op log survives restore; #19 Gentoo GURU vs pinned musl installer path. Decisions are human-owned; record them here before implementation.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
