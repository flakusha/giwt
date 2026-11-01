<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: backup dump test fixture uses a fixed .tmp/giwt-backup-fixture path — parallel runs collide

**Status:** Done
**Priority:** low
**Effort:** Medium
**Tags:** test-flake
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Signature: expected 'could not acquire backup lock', got ENOENT on the fixed-path fixture lock dir. Recurred once during a coverage run, absent in two clean reruns — parallel-execution hazard, not app logic. Do not implement yet: filed for triage.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-01T07:16:56.212Z
