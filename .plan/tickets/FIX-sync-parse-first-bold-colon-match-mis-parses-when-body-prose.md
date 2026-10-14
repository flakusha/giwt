<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: sync-parse first-bold-colon match mis-parses when body prose re-spells a field or metadata drifts past line 30

**Status:** Done
**Priority:** high
**Effort:** Medium
**Tags:** tickets, parser, sync

**Summary:**

Problem: src/tickets/sync-parse.ts takes the FIRST bold-colon match within the first 30 lines as a metadata field. When body prose re-spells a field verbatim (e.g. a Context paragraph containing the literal Tags-header string), or the real metadata block drifts past line 30, the wrong text is parsed and index fields are corrupted with prose fragments.

Evidence: loop-lore ticket `TASK-plan-index-tagging-binding-reconciliation` had its index tags corrupted into 6 prose fragments scraped from its Context paragraph; loop-lore commit 1f970fadc repaired the ticket md and added a regression test mirroring the corruption. giwt itself was untouched (pinned dep) - the root cause lives here. giwt own .plan/tickets/index.json also contains an entry whose epic field holds a re-spelled tags string.

Scope: tighten field anchoring in src/tickets/sync-parse.ts - anchor on a dedicated metadata block region, or prefer the LAST field-line match in the header region; choose the most defensible minimal fix. Add a regression test with an inline re-spelling case.

Acceptance criteria:

- [ ] A ticket md whose body prose contains a verbatim field re-spelling parses the real header values
- [ ] Regression test added and passing
- [ ] Existing sync-parse tests unbroken

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
