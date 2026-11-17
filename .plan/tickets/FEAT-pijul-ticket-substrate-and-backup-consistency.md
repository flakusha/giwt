<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul ticket substrate and backup consistency

**Status:** Not Started
**Priority:** medium
**Effort:** medium
**Tags:** pijul
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Pijul integration gaps from the audited research: OPEN-QUESTIONS #7 (git-issue has no pijul substrate — side git repo, .plan-only tickets, or defer ticket sync), #14 (.pijul/pristine is an mmap'd Sanakirja DB; no consistent hot-backup dump — quiesce, stop-the-world, or explicit exclusion), #6 (skip-ledger semantics with immutable change hashes vs unrecord/re-apply), plus INVENTORY rows for history audit/resurrected/weave detectors in a pijul repo. Human decisions required; record them here before implementation.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
