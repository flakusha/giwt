<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: doctor check caps findings at 20 with no truncation notice - silently hides 113 of 134 real findings

**Status:** Not Started
**Priority:** low
**Effort:** Small
**Tags:** doctor, check, reporting

**Summary:**

src/doctor/check/types.ts:72 CHECK_MAX_FINDINGS = 20, applied at src/doctor/check/run.ts:79, src/doctor/check/tools.ts:164 and :213. 'giwt doctor check' reports '20 finding(s)' and truncates silently, hiding 113 of 134 real findings (133 options-object-params warnings + 1 no-useless-constructor). No 'N more not shown' indication. Suggested fix: a '... N more not shown' line, or an --all flag. Reporting/UX only - does not affect any gate.

**Context:**

## Where the cap lives

- `src/doctor/check/types.ts:72` — `export const CHECK_MAX_FINDINGS = 20;`
  ("Max findings kept per check (bounds JSON + human output)")
- applied at `src/doctor/check/run.ts:79`, `src/doctor/check/tools.ts:164`,
  `src/doctor/check/tools.ts:213`

## Observed

`giwt doctor check` prints "20 finding(s)" and stops. The real total is 134:

| kind | count |
| --- | --- |
| options-object-params warnings | 133 |
| no-useless-constructor | 1 |

So **113 of 134 findings are silently hidden**, with no indication that
truncation occurred. A reader has no way to tell a complete report from a
capped one.

## Suggested fix

Either a trailing "… N more not shown" line, or an `--all` flag that lifts the
cap. The notice is the smaller diff; `--all` is more useful.

**Severity:** Low — reporting/UX only, does not affect any gate.

**Acceptance Criteria:**

- [ ] Capped output states how many findings were omitted (e.g. "… 114 more not shown")
- [ ] Uncapped output is unchanged
- [ ] JSON output carries the same information as the human output
- [ ] A test covers the "more findings than the cap" case and fails if the notice is missing
