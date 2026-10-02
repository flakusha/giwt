<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: browser e2e 404 allowlist masks real 404s

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** e2e

**Summary:**

Target: loop-lore, tests/e2e/helpers/htmx-alpine.ts.

EXPECTED_404_NOISE_ALLOWLIST is a single blanket regex - /Failed to load resource: the server responded with a status of 404/ - applied to every tracked request/response error and every pageerror-observed console message in a browser spec. Anything 404 in that file is therefore masked, including a genuinely unexpected 404 that the spec was meant to catch.

Precedent for the better shape already exists in the same helper: navigation.browser.ts keeps both a blanket constant and a narrower endpoint-scoped regex, and comments that an endpoint URL scoped alone would be insufficient.

Acceptance: the allowlist entries in characters-flow.browser.ts are scoped so that only the known game-state endpoint is masked; a 404 from any other resource still fails the spec; non-404 responses, request failures and JS page errors keep failing as today.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-02T00:33:15.676Z fixed in loop-lore a08b6df: EXPECTED_404_NOISE_ALLOWLIST scoped to /api/v1/chats/:id/game-state; navigation.browser.ts 13/13 green
