<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: giwt feature-matrix: project dimension (upstream seam)

**Status:** Not Started
**Priority:** low
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Upstream feature request from loop-lore project-metadata spec §10.4(ii). Add a project dimension to the feature matrix (feature-matrix.ts columns/rows). Format break requiring a versioned renderer change; deferred until a concrete consumer exists (now: loop-lore project metadata). Source: loop-lore ProjectMetadata-SPEC-DRAFT §10.4.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
