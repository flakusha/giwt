<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: Ticket index: tags end-to-end + unbound-to-epic advisory notice

**Status:** Done
**Priority:** medium
**Effort:** Medium

**Summary:**

**Context:**

Review findings (src/tickets/sync-ticket.ts, sync-index.ts, src/plan/validate.ts):

1. Tags: IndexEntry.tags exists but is dead — parseTicketFile never parses **Tags:**, applyFixes hardcodes tags: [] on orphan adoption, no consumer reads them. Implement: parse **Tags:** comma-list in parseTicketFile (same convention as src/plan/gen-docs.ts:59), thread through TicketFile, use tf.tags on orphan adoption, add repeatable --tag flag to src/commands/ticket.ts writing the **Tags:** line. Preserve existing tags on rewrite (applyFixes spread already does).

2. Unbound-to-epic notice: reconcile() never flags entries with epic === "". Add advisory bucket unboundEpics (extid list) — must be advisory (yellow), NOT added to the gating totalIssues sum (index has hundreds of legitimately epicless tickets). Report block in runSync with slice-10 pattern. Optionally a warn-level Finding in checkLinkage for absent **Epic:** line (consider sentinel or flag before default-on). One-line warn in ticket.ts when --epic omitted.

Tests: extend sync-ticket-index.test.ts fixture cases for tag parse + unbound advisory.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
