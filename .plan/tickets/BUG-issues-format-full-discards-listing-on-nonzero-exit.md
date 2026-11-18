<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: issues --format full discards listing on nonzero exit

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** issues
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Upstream git issue ls --format full can exit 1 with empty stderr when the last listed issue has no detail line. src/commands/issues.ts issueLs uses gitSync, which throws and discards stdout, so giwt issues --format full prints nothing even though the listing is usable. Fix: preserve non-empty stdout on nonzero exit using a spawn seam that returns stdout/stderr/exit; keep the error path for empty stdout. Regression: git shim where issue ls --format full exits 1 with stdout still renders the listing.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
