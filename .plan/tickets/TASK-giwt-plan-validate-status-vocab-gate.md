<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: Add `giwt plan validate --status-vocab` gate (closed enum + fix)

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** plan-validate, drift

**Summary:**

Default-on `status-vocab` gate in `giwt plan validate` (`src/plan/status-vocab.ts` + `src/plan/validate.ts`): a closed enum over the defaults plus `[status.aliases]`, with an annotation-preserving, fence-aware `--fix` that normalizes aliases.

**Context:**

Implemented 2026-09-26: default-on `status-vocab` gate in `giwt plan validate` (`src/plan/status-vocab.ts` + `src/plan/validate.ts`); `--fix` normalizes aliases (defaults + `[status.aliases]`), annotation-preserving, fence-aware. Landed in 6d0dd1b/d40da74.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated

git issue: 0265374
