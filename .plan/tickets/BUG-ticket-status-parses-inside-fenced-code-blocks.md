<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: ticket Status parses inside fenced code blocks

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** parser, status
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

The ticket-markdown parser is fence-blind: src/tickets/sync-parse.ts line-scans the 30-line header window for a Status marker, so a Status-looking line inside a fenced code block can win first-match and set the wrong status, while the format gate scans the whole file. Parser and gate can disagree on the same file. Sibling divergence precedent: BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re, BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick. Downstream report: loop-lore .tmp/research/giwt-md-json-roundtrip-gaps-2026-11-26.md; loop-lore mirror ticket BUG-plan-ticket-status-parses-inside-fenced-code-blocks (issue b45712e). Acceptance: a fenced Status-looking line never determines ticket status; parser and gate agree on the measured corpus.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-26T12:50:21.809Z
