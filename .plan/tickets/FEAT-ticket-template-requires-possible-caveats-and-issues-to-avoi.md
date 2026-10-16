<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: ticket template requires possible caveats and issues to avoid

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** validation, ticket-template, safety

**Summary:**

Problem: ticket templates capture Summary, Context, and Acceptance Criteria, but do not require an implementation-hazard field. Filers can omit TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, cleanup, and rollback edge cases, so acceptance can pass while a race or privilege check remains untested.

Scope: add a required **Caveats:** field to ticket creation/render and plan templates, seeded with the standard checklist: TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure cleanup, rollback, stale state, data races, idempotency, and observability. Every filed ticket must enumerate the caveats that apply and the validation that proves each non-applicable or mitigated case.

Acceptance criteria:

- Ticket renderer emits **Caveats:** for new tickets and format gates accept it
- Filers cannot omit the field for FEAT/TASK/BUG tickets
- Caveat checklist names TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, and observability
- Existing plan sync/validate rejects generated tickets with an empty Caveats field
- Tests cover renderer output, parser, plan gate, and missing-field failure

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-16T12:02:18.460Z landed on master via plan-links-interconnect merge (09c9101)
