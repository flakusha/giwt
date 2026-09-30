<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: record per-step durationMs in run events

**Status:** Done (shipped: durationMs on RunEvent + readRunEvents surfaced by `giwt runs --json`)
**Priority:** low
**Effort:** Small
**Tags:** runlog, observability

**Summary:**

The RunEvent schema (src/utils/runlog.ts:88-94) is `{ v, ts, step, status, detail }` — a wall-clock timestamp but no duration. Every consumer that wants to know how long a step took has to diff consecutive timestamps itself, and the last step has no successor to diff against.

Concretely: when finalize reports which gate was slow, or when a run is compared against the previous run to find a regression, there is no per-step cost in the record. The step boundaries are already known, so the duration is derivable at write time.

**Context:**

Fix: add `durationMs` to RunEvent, measured from the previous event in the same run. The first event has no prior, so it is null/omitted.

Evidence: src/utils/runlog.ts:88-94

**Acceptance Criteria:**

- [x] RunEvent carries durationMs for every event that has a predecessor in the same run
- [x] The first event of a run has no durationMs (or null), never 0-as-a-real-measurement
- [x] RunMeta and `giwt runs --json` output surface the new field
- [x] A test writes two events and asserts the second's durationMs is non-negative and >= 0

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
