<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: commit-wt on-protected-branch direct commit scenario

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

Agents parked on the protected main checkout cannot use commit-wt (refused) yet sometimes must commit directly (docs, ticket sync, hotfixes). Implement an explicit --on-protected override: default refusal unchanged; with the flag, commit in the main checkout (repoRoot) via the same GPG-signed pipeline with a loud warning; flag on a non-protected branch is an error.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] `commit` refuses a direct commit on a protected branch without `--on-protected`; with it, warns and proceeds
- [x] `commit-wt <protected>` without the flag keeps refusing; with it, verifies the main checkout branch and routes the commit to `repoRoot` via the same GPG-signed pipeline
- [x] `--on-protected` on a non-protected branch is an error; mismatched main checkout is an error
- [x] Tests: `src/commands/commit-protected.test.ts` (6 cases, mkdtemp fixtures, parallel-safe) — 27/27 module+adjacent pass
**Resolved:** 2026-10-02T01:00:35.237Z verified: --on-protected contract + 27/27 commit-protected tests pass
