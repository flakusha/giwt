<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: ticket-id-inputs-accept-hash-extid-slug-everywhere

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

Every giwt command that takes a ticket id MUST accept all four forms agents actually paste: hex hash (`e325a4e`), uppercase extid (`TASK-FOO-BAR`), lowercase slug (`TASK-foo-bar`), and filename (`TASK-foo-bar.md`). Three resolvers currently split the forms: `resolveExtid` (show/state/comment/edit/attach) accepts all four; `resolveScopedTickets` (`new --tickets`) matches `.plan/tickets/*.md` filenames only so a raw hash fails with `unknown ticket id` (hit yesterday passing `e325a4e`); `lookupTicket` (`ticket close`/`copy`) matches index key + source basename only, no hash.

**Context:**

Unify on one resolver: make `resolveScopedTickets` and `lookupTicket` fall back to `resolveExtid` (registry walk) when the file/index match misses, so hash input resolves everywhere. Substring semantics caveat: `resolveExtid` is first-match-wins on `issue ls` line order with no ambiguity error, so the fallback inherits that — acceptable for exact extid/slug/hash inputs, do not add fuzzy matching.

Alternative considered: document per-command forms in USAGE — rejected, agents paste whatever form is at hand and the failure looks like a missing ticket.

**Acceptance Criteria:**

- [ ] `new --tickets e325a4e` (raw hash) resolves the scoped ticket instead of `unknown ticket id`
- [ ] `ticket close` / `ticket copy` accept a hex hash alongside extid/slug/slug.md
- [ ] One shared resolution path (scoped + lookup delegate to `resolveExtid` fallback, not a fourth copy)
- [ ] Tests: hash-form cases on the scoped and close/copy paths; `bun run check` green
- [ ] `show 40464b1.md` resolves: strip `.md` before the hash passthrough, not just before the extid match (today the suffix leaks into `hash`)
- [ ] USAGE table (`cli-usage.ts`) + `ticket close`/`copy` usage lines updated to the accepted `<hash|extid|slug|slug.md>` forms
