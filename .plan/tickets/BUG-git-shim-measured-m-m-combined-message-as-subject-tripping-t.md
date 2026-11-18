<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: git shim measured -m/-m combined message as subject, tripping the 72-char gate

**Status:** Done
**Priority:** Medium
**Effort:** Small
**Epic:** epic-vcs-backends.md
**Tags:** git-passthrough, commit-message
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:** the giwt git shim measured the whole combined -m/-m message against the 72-char subject limit, refusing valid commits (observed: 392-char subject). Fixed by the git-trailers extraction: -m values are joined with a blank line before validation, so only the first line of the first -m is measured.

**Context:** foreign git issue 352f8d2 (refs/issues/352f8d22), filed against fb23aa5cd from a loop-lore lane. The commit-msg hook itself was correct (head -n 1); the shim hygiene gate mismeasured. No consumer workaround beyond -F was needed.

**Acceptance Criteria:**

- [x] long body in a later -m is not measured as the subject (src/commands/git.test.ts:245)
- [x] over-wide first -m is still blocked (src/commands/git.test.ts:259)
- [x] foreign issue 352f8d2 closed as duplicate
- [x] Tests passing
