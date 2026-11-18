<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul ticket substrate and backup consistency

**Status:** In Progress
**Priority:** medium
**Effort:** medium
**Tags:** pijul
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Pijul gaps from `.tmp/research/pijul/`: OPEN-QUESTIONS #6, #7, #14 plus INVENTORY history-audit/resurrected/weave detectors in a pijul repo.

**Decisions (2026-11-18, user-approved):**

- Ticket substrate is **unsupported in pijul mode**: git-issue has no pijul equivalent, so giwt explicitly refuses with documentation — no side git repo and no silent `.plan`-only ticket sync.
- Hot backups **exclude `.pijul/pristine` with a loud warning**: it is an mmap'd Sanakirja DB with no consistent hot-backup dump; no quiesce/stop-the-world machinery — document the exclusion instead.
- The skip ledger **dissolves** for immutable pijul change hashes (intrinsic patch ids); re-apply/unrecord needs no skip entry.
- History-audit, resurrected and weave detectors must work against change-hash history, not git patch-ids.

**Acceptance Criteria:**

- [x] Ticket/issue commands in pijul mode refuse with an actionable message and docs; a shared guard runs before any git-issue call, so no side git repo is created.
- [x] Hot-backup config explicitly excludes `.pijul/pristine` and emits a loud warning naming the unbacked-up pristine store; a test asserts both.

**Landed 2026-11-18:** ticket-substrate guard and backup exclusion. Skip-ledger dissolution and change-hash-based history detectors remain open.

- [ ] Define and test skip-ledger behavior on immutable change hashes (no skip entry needed on re-apply/unrecord).
- [ ] Operate history-audit/resurrected/weave detectors on change-hash history and test them in a pijul repo.
- [ ] `bun run check` passes; docs updated; SPDX headers on new files.

**Not in this ticket:** pijul native command integration, git-interop bridge.
