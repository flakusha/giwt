<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: normalizeStatus leaves 'Not Started' entries in 'other' bucket, undercounting open workstack

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** plan, status-vocab
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Mechanism: normalizeStatus (src/tickets/sync-normalize.ts:4-59) maps done/in_progress/draft/cancelled and an open-class regex (lines 47-50: open|deferred|todo|research-needed|follow-up), but has NO pattern for 'Not Started'. After emoji stripping (lines 17-19), '⬜ Not Started' → 'not started' still matches nothing, so it falls through to the freeform pass-through return at line 58 and lands in the 'other' bucket of consumers like feature-matrix (src/plan/feature-matrix.ts:59) and plan/normalize-statuses.ts. Impact: in downstream loop-lore, epics frontmatter carries 'Not Started'; ~530 entries in the ticket index/epics are classified 'other' in generated .plan/priority-matrix.md / status views, so open-workstack aggregation undercounts actionable work — a canonical 'not started' status is invisible to the open bucket. Suggested fix: map /\bnot[- ]started\b/i → 'open' in normalizeStatus (emoji prefix already stripped upstream); keep it before the open-class check and away from the partial/done regexes. Test: extend the normalizeStatus describe block in src/tickets/sync-ticket-index.test.ts with normalizeStatus('Not Started') → 'open', normalizeStatus('⬜ Not Started') → 'open', normalizeStatus('NOT STARTED') → 'open'.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated (verified: no doc enumerates the normalizeStatus open-class patterns; nothing to update)
