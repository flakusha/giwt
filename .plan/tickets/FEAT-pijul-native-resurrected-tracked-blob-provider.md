<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul native resurrected tracked blob provider

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** pijul
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Related:** FEAT-pijul-ticket-substrate-and-backup-consistency.md

**Summary:**
The generic resurrected detector (`src/audit/resurrected.ts`) works on git tracked blobs. In pijul mode only the change-hash audit and weave-on-files work (`src/history/pijul-audit.ts`); resurrected is still inapplicable because there is no non-git provider for tracked paths/content twins. Pijul records are immutable change DAGs, so twin detection must read pijul state, not git.

**Acceptance Criteria:**

- [ ] Add a pijul tracked-blob/path provider and wire the resurrected detector to it under `backend = "pijul"`.
- [ ] Test duplicate-number and content-twin findings in a pijul repo; no git spawn in pijul mode.
- [ ] Document the source of truth (change hashes plus tracked file content) and any known ceiling of the heuristic.

**Context:**
No git fallback is allowed under `backend = "pijul"`; the detector must use pijul state and filesystem content only. Existing duplicate-number/content-twin semantics from the git detector define expected findings.
