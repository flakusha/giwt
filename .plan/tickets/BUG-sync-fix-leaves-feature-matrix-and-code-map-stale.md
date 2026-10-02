<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: sync --fix leaves feature-matrix and code-map stale

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** tickets, sync

**Summary:**

giwt sync --fix mutates .plan state (status rewrites, closes) but does not regenerate .plan/feature-matrix.md, so the matrix freshness gate in plan validate fails on the very next run and the agent must run giwt plan matrix + plan code-map by hand. Observed upstream 2026-09-29: after sync --fix, matrix and code-map freshness gates both failed until regenerated manually.

Fix: when a --fix pass applies plan-affecting fixes, regenerate the feature matrix (and code-map if indexed paths changed) as part of the same pass so one command leaves plan state consistent.

Acceptance criteria:

- sync --fix leaves the matrix freshness gate green without a manual plan matrix run
- regression test: fixture repo where sync --fix rewrites status -> matrix regenerated
- bun run check green

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] sync --fix regenerates existing feature-matrix.md + code-map.json when fixesApplied > 0 (missing artifacts never invented)
- [x] Regression tests: artifact-rewritten + dry-run-untouched cases in sync.test.ts (8/8)
- [x] bun run check green
**Resolved:** 2026-10-02T01:03:59.963Z sync --fix regenerates matrix+code-map; regression tests green
