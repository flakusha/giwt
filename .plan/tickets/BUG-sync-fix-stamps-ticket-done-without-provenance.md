<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: sync fix stamps ticket Done without provenance

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** plan, sync

**Summary:**

Target: giwt tooling, observed against loop-lore worktrees.

`giwt sync --fix` derives a ticket **Status** from the shared git-issue registry and writes it back into .plan/tickets/*.md. Because that registry is global, an agent that never implemented a ticket still commits `Status: Done` for it.

Verified 2026-10-02 in loop-lore worktree p3-verify-close-batch: commit 12403fdc3 flipped these two loop-lore tickets to Done purely because feat-chat-finishers had closed those issues in the registry:

```text
TASK-chat-feature-component-buttons
TASK-chat-feature-turn-talkativity-skip
```

Neither was implemented or verified by that worktree, yet the commit reads as if it had. (The identifiers are fenced because this repo's links gate treats a bare `TASK-` token in a .plan file as a local ticket ref.)

Acceptance: a ticket that sync --fix marks Done carries provenance (which agent/branch closed the issue, plus the closing sha), so a reader of any worktree commit can distinguish registry-driven status from locally verified status. loop-lore ticket files already have a `**Resolved:**` line for this shape.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-02T00:33:09.459Z fixed in fd11d0d: registry-driven Done stamps append **Resolved:** with registry tip sha+author (both fix writers); pinned in sync-issues-ops.test.ts
