<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt ticket generates a Status the status-vocab gate then rejects

**Status:** Not Started
**Priority:** Medium
**Effort:** Small
**Tags:** status-vocab, ticket

**Summary:**

`giwt ticket` writes `**Status:** ⬜ Not Started` (src/commands/ticket.ts:117), which the `status-vocab` gate — shipped in the same repo — reports as a violation for that brand-new file. Every ticket the command creates therefore lands red.

**Context:**

`resolveStatus` (src/plan/status-vocab.ts:72) strips leading emoji before matching, so the value is classified `fixable` and `plan validate --fix` repairs it:

> fixed: ... `"⬜ Not Started"` → `"Not Started"`

So the round trip is: create a ticket, and the tool that created it reports a violation, needing a second command to clean up. On CI where `plan validate` gates the build, a freshly-created ticket fails the gate it was just born violating. The generation and the gate disagree about what a valid Status line looks like, and the generator is the side that is wrong: no existing ticket in `.plan/tickets/` carries the `⬜` decoration, so the emoji is drift that crept into the template rather than a house convention.

**Acceptance Criteria:**

- [ ] `giwt ticket` emits a Status value that passes `plan validate --gates status-vocab` on the file it just created
- [ ] The generated template matches the house style used by the existing tickets in `.plan/tickets/`
- [ ] A test asserts a `giwt ticket`-generated file is status-vocab clean, so the two cannot drift apart again
- [ ] Existing tickets using the emoji, if any, are normalized
