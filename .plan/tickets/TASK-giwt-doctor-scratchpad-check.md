<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: Add `giwt doctor scratchpad` check (size + orphan + oldest)

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** doctor, scratchpad

**Summary:**

`giwt doctor scratchpad` check (size + orphan + oldest): a `scratchpad` CheckId in `src/doctor/check.ts`, also usable as the `giwt doctor scratchpad` shorthand, reading the shared `scanScratch()` in `src/utils/scratch.ts` with thresholds from flat `[doctor] scratchpad_*` keys.

**Context:**

Implemented 2026-09-26: `scratchpad` CheckId in `src/doctor/check.ts` (also `giwt doctor scratchpad` shorthand), reading the shared `scanScratch()` in `src/utils/scratch.ts`; thresholds via flat `[doctor] scratchpad_*` keys. Landed in 6d0dd1b.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated

git issue: 3974a83
