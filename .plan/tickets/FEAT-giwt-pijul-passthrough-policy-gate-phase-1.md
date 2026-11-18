<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: giwt pijul passthrough policy gate (phase 1)

**Status:** Done
**Priority:** medium
**Effort:** small
**Tags:** pijul, passthrough
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Phase-1 pijul support derived from the audited dossier at .tmp/research/pijul/ (NOTES, INVENTORY, OPEN-QUESTIONS, AUDIT PJ-1..PJ-5). Build a safety-gated giwt pijul passthrough mirroring giwt git: RO/RW/BLOCK classifier from the dossier policy table, refusal of -k/--no-cert-check anywhere in argv (PJ-1), --config allowlist (err-open overrides), refusal of --author/--timestamp and conflict-marker/editor shapes, [pijul] safe/allow/deny settings, run-record capture, CLI/usage/public-API wiring, and behavior tests. Broader pijul integration (channels, signing, conflicts, ticket substrate, backup) is tracked in the pijul roadmap ticket.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
