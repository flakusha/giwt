<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: runs failure triage: extract fail blocks and diff two runs

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** reporting, runlog

**Summary:**

giwt runs lists records and finalize names failed gates, but nothing mines test output. Recurring scratch need: faildetail extracts fail blocks with context from bun test logs, faildiff set-diffs two sweeps into new-vs-fixed, summarize groups failures by file. Acceptance: runs subcommand or flag printing failure blocks with context from a run record, plus a two-run new-vs-fixed diff.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-01T02:12:54.189Z shipped in 38b44a5 on feat/new-tickets
