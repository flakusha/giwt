<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: finalize does not surface gate results on failure

**Status:** Done
**Priority:** high
**Effort:** Medium

**Summary:**

Symptom (2026-09-18 omp session forensics): agents ran finalize, got exit 1 and "Checks failed — fix before finalizing (or use --force)" with no gate detail, then had to dig for the report.

**Context:**

Evidence:

- minimax session 2026-09-18T01-15-39 @ 01:40:20: "11 gates ran and one (or more) failed. Need to see which. Finalize does not show the report" — then 4 tool calls to locate and jq .tmp/check-report.json (103.4 KB) in the worktree.
- src/commands/finalize.ts runCheck captures the runner output to capturePath("check.log") and passes through only runner stderr; loop-lore check runner prints the PASS/FAIL table to stdout, so the table never reaches the console.
- The auto-gripe appends "finalize `<b>` failed (exit 1) — see console output" to the ledger — a pointer to a console that no longer has the content, while the real data sits in check.log / check-report.json / test.log inside the run dir.
- Fallout today: ~15 finalize attempts across 4 loop-lore branches ending in worktree removal (remove), plus one --force escape in giwt repo, all because failures were opaque.

Acceptance:

- On gate failure, finalize stdout/stderr prints: failing gate names, per-gate first N error lines, and absolute artifact paths (check.log, test.log, check-report.json, run dir).
- The gripe ledger line carries the run dir and failing gate names instead of "see console output".
- A reproduce scenario (gate fails via --gates on a scratch repo) shows the failing gate name on stdout without opening any file.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
