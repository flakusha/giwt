<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj colocated history detectors on change ids and evolog

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Related:** FEAT-jj-audit-backup-and-version-policy.md

**Summary:**
Phase 2 landed the change-ID skip ledger (`src/history/jj-history.ts`) and the version floor, but `src/audit/` has no jj-aware provider: history-audit, resurrected and weave still assume git patch-ids/refs. On a colocated jj repo the backing git store is available, but jj rewrites commit ids on every op, so detectors need change IDs (and evolog where needed) to remain stable.

**Acceptance Criteria:**

- [ ] Wire audit/history detectors to a colocated jj repo using change IDs + evolog or colocated git plumbing; keep git-mode output unchanged.
- [ ] Test resurrected, rewrite/duplicate and weave findings against a jj repo with rewritten commits.
- [ ] Document in the ticket where git plumbing is authoritative and where jj change IDs must win.

**Context:**
Git plumbing remains authoritative for content and blobs on a colocated repo; jj change IDs are authoritative for commit identity across rewrites. Never regress git-mode output or spawn jj in a git-only repo.
