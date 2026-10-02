<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: show/state resolve plan tickets filename slugs

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** dx

**Summary:**

`giwt show <ID>` and `giwt state <ID>` resolve only uppercase extids (BUG-FOO-BAR) and hex hashes. They do not resolve the lowercase `.plan/tickets/` filename form (`BUG-foo-bar.md`) or the kebab-case index keys agents actually see, so pasting the visible slug yields a false-negative "issue not found" and agents conclude the ticket does not exist. Filed from a 10-slug probe: 10/10 failed with the canonical filename form.

Fix: resolver (`resolveExtid`, `src/commands/show.ts`) accepts bare slug, `slug.md`, uppercase extid, and hex; prefer exact slug match, fall back to substring with existing ambiguity error.

Acceptance criteria:

- `giwt show BUG-foo-bar.md` and `BUG-foo-bar` both resolve
- ambiguous substring overlap still errors loudly
- tests cover all four input forms
- bun run check green

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] `giwt show BUG-foo-bar.md` and bare slug both resolve (resolver.ts strips .md; case-insensitive substring already handled slugs)
- [x] Ambiguous substring overlap still errors loudly (unchanged behavior)
- [x] Tests: resolveExtid input-form cases in show.test.ts (uppercase extid / lowercase slug / slug.md / hex)
- [x] bun run check green
**Resolved:** 2026-10-02T01:04:00.062Z resolver strips .md; input-form tests green
