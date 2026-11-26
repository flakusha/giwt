<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: normalize Epic field spelling variants in linkage

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** linkage, epic
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

The linkage gate only recognizes the **Epic:** spelling, so the **Epic**: variant leaves tickets phantom-unbound. Accept both spellings and canonicalize on parse. Downstream report: loop-lore .tmp/research/giwt-md-json-roundtrip-gaps-2026-11-26.md; loop-lore mirror ticket TASK-normalize-epic-field-spelling-variants-in-linkage (issue ee15807). Acceptance: both spellings bind; no phantom-unbound tickets remain on the measured corpus.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-26T12:50:21.809Z
