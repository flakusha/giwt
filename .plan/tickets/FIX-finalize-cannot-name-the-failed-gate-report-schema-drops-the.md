<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: finalize cannot name the failed gate: report schema drops the name field

**Status:** Done (duplicate of BUG-finalize-check-failure-report-never-names-failed-gates-check, 3022ea0)
**Priority:** high
**Effort:** Medium

**Summary:**

finalize prints a 'Failed checks' section containing only PASS lines and never the failing gate, because reportCheckFailure reads check.name while the check-report.json schema emits only check.command.

**Context:**

Root cause: loop-lore scripts/check-parallel.mjs buildReport() at line 842 serializes each check as {command, passed, exitCode, durationMs, output, truncated} — the internal name field is dropped. src/commands/finalize.ts reportCheckFailure() (line 758) parses checks[] and pushes {name: check.name}, which is always undefined. failed[] therefore stays empty, LAST_FAILED_GATES stays [], and the code falls through to printTail(stdout) — the runner's raw stdout, which is a wall of PASS lines.

Observed 2026-09-26 (loop-lore, run 2712788): 22/23 gates passed, one failed, and the entire 'Failed checks' block was PASS: backlog - index, PASS: code-map - freshness, ... PASS: plan - ticket index (sync) — no gate name anywhere. The actual failure (plan:map:check, stale code-map.json) took three finalize attempts plus a check-report.json parse to find. The gripe line also degraded to a bare failure message with no gate names, because LAST_FAILED_GATES is empty.

This is a regression against FIX-finalize-does-not-surface-gate-results-on-failure (marked Complete): the reportCheckFailure mechanism was added, but it was written against a report schema whose name field is never emitted, so it has never actually resolved a gate name. Its own acceptance criteria are all unchecked.

Compounding defect: the printTail(stdout) fallback renders the runner's stdout under a heading called 'Failed checks'. When failed[] is empty the section can contain zero failed checks and zero gate names — strictly worse than printing nothing, because it reads as gate output.

Two fixes needed, both in giwt:

1. Resolve the gate name from either field — check.name ?? check.command — so it works against every report schema in the wild, including reports emitted before the name field existed. command is the human-readable gate label ('md:lint', 'plan:map:check'), which is exactly what the operator needs.
2. When failed[] is empty, say so explicitly ("no failing gate found in the report") rather than dumping arbitrary stdout under a 'Failed checks' heading. If the stdout tail is kept, label it as such.

Regression test: a fixture check-report.json with a failing entry carrying only command (no name) must produce a reportCheckFailure section naming that command. Test the passing case too — a report where all checks passed must not print a 'Failed checks' section containing PASS lines.

**Acceptance Criteria:**

- [x] Implementation complete — `reportCheckFailure` resolves `check.name ?? check.command` and tolerates `output: null`; fixed alongside BUG-finalize-check-failure-report-never-names-failed-gates-check
- [x] Tests passing — regression fixture uses the real runner shape (command-only, `output: null`); all-`name` fixtures still green
- [x] Documentation updated — finalize failure-path label added: an empty failed[] under "Failed checks" now prints "no failing gate found in the check report — showing the runner's stdout tail:" before the tail, so PASS lines no longer masquerade as gate results
- [x] Duplicate note: same defect as BUG-finalize-check-failure-report-never-names-failed-gates-check (3022ea0); tracked there

Fixed in 5adb4c4 (finalized to master). Duplicate of 3022ea0; closed as duplicate in the registry.

git issue: 0b773e3
