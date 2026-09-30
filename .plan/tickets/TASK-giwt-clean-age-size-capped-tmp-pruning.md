<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: Add `giwt clean` for age/size-capped .tmp pruning

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** scratchpad, cleanup

**Summary:**

`giwt clean` for age/size-capped .tmp pruning: `src/commands/clean.ts` over the shared scanner `src/utils/scratch.ts`, with `--dry-run` (default), `--apply`, `--json`, `--verbose`, and `[scratch]` settings (tmp_max_age_days 7, lcov_keep_latest 2, jscpd_max_age_days 7, check_report_keep 20).

**Context:**

Implemented 2026-09-26: `giwt clean` (`src/commands/clean.ts`) over the shared scanner `src/utils/scratch.ts`; `--dry-run` default, `--apply`, `--json`, `--verbose`; `[scratch]` settings with defaults (tmp_max_age_days 7, lcov_keep_latest 2, jscpd_max_age_days 7, check_report_keep 20). Landed in 6d0dd1b.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated

git issue: b432ffb
