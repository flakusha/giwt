<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: tag parser keeps bracket-quote-backtick adornments producing ghost matrix rows

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

Repro: src/tickets/sync-parse.ts parseTicketText line 101 splits the Tags line on commas with trim only. Loop-lore tickets with JSON-style headers (e.g. TASK-check-parallel-gates-filter.md line 16: Tags line with bracket-quoted list) yield matrix rows like bracket-quote adorned check/inference/worktree plus backtick rows (see loop-lore .plan/feature-matrix.md lines 14-28). Actual: By-tag table carries adorned ghost tags. Expected: tokenizer strips surrounding brackets/quotes/backticks per token (accept JSON-array style) or validate rejects it with a hint. Fix direction: normalize each token in parseTicketText and drop empties. Distinct root cause from the template-duplication bug. Note: epic-field body-prose pollution in loop-lore index.json looks like stale index from the pre-header-region parser; current first-30-lines scoping already covers it.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-08T03:48:39.046Z Fixed by 97c77bd: normalizeTagToken strips bracket/quote/backtick adornments from Tags tokens. Merged to master via fix-ticket-parse-template.
