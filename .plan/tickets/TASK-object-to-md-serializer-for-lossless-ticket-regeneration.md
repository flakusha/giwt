<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: object-to-md serializer for lossless ticket regeneration

**Status:** Not Started
**Priority:** high
**Effort:** Large
**Tags:** serializer, roundtrip
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

The md-to-object direction exists (parse to index.json) but no object-to-md serializer does, so normalization is idempotent at field level but the document cannot be regenerated. Body prose, section order, Caveats, Effort, Upstream, Related, Status Note, owner, SPDX, and provenance are all absent from the object form and would not survive a rewrite. Fund after id-unification and owner-claim decisions, in order: serializer, id unification, owner-claim, AC structure. Downstream report: loop-lore .tmp/research/lolo-harness-doc-schema-addendum-md-roundtrip-2026-11-26.md; loop-lore mirror issue 90759e6. Acceptance: parse-serialize-parse is a fixed point on the measured corpus.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
