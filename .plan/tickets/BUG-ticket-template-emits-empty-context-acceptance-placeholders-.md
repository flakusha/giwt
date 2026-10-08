<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: ticket template emits empty Context/Acceptance placeholders alongside user-supplied body fields

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

Repro: src/commands/ticket/create.ts renderTicketFile lines 87-93 writes Summary plus user body, then unconditionally appends the empty Context (fill in before starting...) placeholder and generic Acceptance checklist. Live example: loop-lore tree/matrix-research-followup/.plan/tickets/TASK-fb9-gallery-private-asset-auth-gating-logxgal.md lines 6-22 carry filled Status/Priority/Effort/Summary/Context/Acceptance, then lines 24-32 repeat the empty placeholders. Actual: every ticket generated with a field-bearing body ships duplicated empty sections; the format gate passes (presence-only) so the noise lands silently. Expected: fields present in the user body suppress the corresponding placeholders; no duplicated sections. Fix direction: detect Context/Acceptance Criteria (and Status/Priority/Effort/Summary) markers already present in body and skip emitting those placeholder blocks.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-08T03:48:39.026Z Fixed by 74e926e: hasSection suppresses template placeholders for body-supplied fields. Merged to master via fix-ticket-parse-template.
