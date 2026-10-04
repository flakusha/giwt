<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: commit co-author trailer policy: strip LLM, keep real, aggregate in squash

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, coauthors

**Summary:**

Shared src/utils/coauthors.ts (denylist + ALLOWED_TRAILERS from .credentials.env walk-up, mirrors .githooks/commit-msg). giwt git commit/merge: filter message trailers (LLM stripped, real kept), event records stripped/kept. finalize squash: aggregate Co-Authored-By from squashed commits (dedupe, filter LLM) into squash message so real co-authors survive the squash.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-04T02:00:46.958Z Landed: src/utils/coauthors.ts (denylist + ALLOWED_TRAILERS walk-up), filterCoAuthorTrailers wired into giwt git commit/merge, squash aggregation squashMessageWithCoAuthors in finalize/staging.ts:160; coauthors.test.ts
