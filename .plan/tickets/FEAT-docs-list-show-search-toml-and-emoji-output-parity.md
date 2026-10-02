<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: docs list/show/search toml and emoji output parity

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Epic:** output-tooling
**Tags:** output

**Summary:**

docs subcommands accept only --json; the other data commands accept --json|--toml|--emoji via parseOutFlags. Add --toml/--emoji to docs list/show/search for output parity.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] `docs list|show|search` accept --json|--toml|--emoji via parseOutFlags (dump stays raw bytes)
- [x] Tests: 3 parity cases in docs.test.ts (toml round-trip, emoji mappers, --json unchanged) — 45/45 module green
- [x] USAGE_TEXT updated
**Resolved:** 2026-10-02T01:03:33.392Z parseOutFlags parity landed; toml/emoji tests green
