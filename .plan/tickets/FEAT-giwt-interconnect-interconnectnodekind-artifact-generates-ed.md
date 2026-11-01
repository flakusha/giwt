<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: giwt interconnect: InterconnectNodeKind artifact + generates edge (upstream seam)

**Status:** Done
**Priority:** low
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Upstream feature request from loop-lore project-metadata spec §10.4(iii). Add InterconnectNodeKind 'artifact' and a 'generates' edge to the interconnect graph (build.ts node kinds) so regeneratable artifacts can be represented. Source: loop-lore ProjectMetadata-SPEC-DRAFT §10.4.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated (types doc)
**Resolved:** 2026-11-01T05:07:05.316Z
