<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: parseTicketFile vs omp-roster: divergence on dual-status tickets

**Status:** Done (omp-plugins landed any-done-line parsing + regression tests — find-work.test.ts 135/135; giwt mirrored it 2026-09-25)
**Priority:** medium
**Effort:** Small

**Summary:**

Giwt's `parseTicketFile` and omp-plugins' `find-work/roster.ts:planFileTicket()` classify the same `.plan/tickets/*.md` file inconsistently when the file contains two `**Status**` lines.

**Context:**

## Reproduction (with same input)

```md
**Status:** Not Started → closed (duplicate)
...
**Status**: duplicate-of-epic-llm-queue
```

- giwt `parseTicketFile` → `status: "done"` (correctly classified, ticket marked closed in index).
- omp-plugins `planFileTicket` → ticket LEAKS into `/find-work` open roster (treated as open work).

## Why this matters

A user runs `giwt sync --fix` and sees the index agree that the ticket is closed. They then run `/find-work` in their agent harness and the same ticket appears as an actionable item. The two tools disagree on the same source-of-truth file.

## Details

- giwt: `src/tickets/sync-index.ts:parseTicketFile()` uses `String.match(/\*\*Status:\*\*\s*(.+)/i)` on the joined header (first 30 lines). Returns the FIRST match (legacy reconciler output: "Not Started → closed (duplicate)"). `normalizeStatus()` then matches `\bclosed\b` → returns "done". Net result: correctly classified as done.
- omp-plugins: `plugins/oh-my-pi-integration/extensions/commands/find-work/roster.ts:planFileTicket()` uses `Array.find` + the same regex but evaluates done against the raw value. "Not Started → closed (duplicate)" doesn't start with a done keyword, so the ticket is treated as open.

## Cross-link

- omp-plugins issue: `BUG-find-work-closed-epic-reconciliation-stubs-leak-into-roster` (filed 2026-09-23 in omp-plugins repo)
- 28 reconciliation stubs in loop-lore (.plan/tickets/EPIC-030..EPIC-058) all hit this divergence — reconciliation patches landed in commits c30c03a3b / 350065abc / 41f7e5789 but /find-work still surfaces them.

## Decision (resolved 2026-09-25)

Option (b) landed in omp-plugins (any done-looking status line closes — `planFileTicket` + `STATUS_DONE_RE` including the `duplicate-of-…` class; regression tests in `find-work.test.ts`, 135/135 green).

giwt mirrored the contract the same day so both parsers agree on **every** dual-status shape, not just the stubs in the wild:

- `parseTicketFile` collects **all** `**Status:**`/`**Status**:` lines in the header (colon in- or outside the bold — the omp `STATUS_LINE_RE` forms) and closes on any done-class line; the first line still wins for `in_progress`/`draft` detection.
- `normalizeStatus` gained the `duplicate-of`/`duplicate` done class (omp `STATUS_DONE_RE` parity).
- `runSync --fix` now also fires when only a status backfill is pending, so a done `.md` + status-less index entry converges even on an otherwise-green report (the mechanism that previously kept Shape B invisible).
- Tests: `src/tickets/sync-ticket-index.test.ts` (dual-status describe) and `src/tickets/sync-issues-ops.test.ts` (Shape B end-to-end: backfill → stale-open close).

Residual, accepted: giwt's done detection is keyword-anywhere while omp's is keyword-at-start; for the marker lines reconcilers actually write (`duplicate-of-x`, `Not Started → closed (…)`) both classify identically.

## Acceptance

- omp-plugins parser produces the same status classification as giwt for dual-status tickets.
- All existing tests pass in both repos.
- Regression test for the dual-status case lives in whichever repo owns the fix.

## Related

- Cross-tool contract note in giwt: `src/commands/doctor.ts:148-151` mentions sharing the DoctorCheckReport contract with `/find-work`. The ticket-status contract has the same implicit dependency; this ticket makes it explicit.
- Loop-lore reconciliation commits: c30c03a3b / 350065abc / 41f7e5789 (all 2026-09-23).

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
