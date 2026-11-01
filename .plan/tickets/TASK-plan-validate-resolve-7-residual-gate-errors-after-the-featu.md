<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: plan validate: resolve 7 residual gate errors after the feature wave

**Status:** Not Started
**Priority:** low
**Effort:** Medium
**Tags:** plan, validate
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

At HEAD `giwt plan validate` reports 7 non-gating errors — (1) links gate: 2 orphan TASK refs (TASK-loop-lore-backup-export-contract, TASK-restore-acceptance) in .plan/tickets/FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen.md; (2) epics-doc: epics-index.md stale (regenerate via `giwt plan gen-docs`); (3) status-vocab: 4 FEAT-giwt-* tickets carry freeform 'Done — …' Status lines (canonicalize to Done). None of the 7 artifacts were touched by 29c4d28..21ac32d; A/B shows the wave improved the count 11→7. If the 4 status-vocab lines are trivially canonicalizable by the close flow later, that's this follow-up's business.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
