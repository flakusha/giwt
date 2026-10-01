<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: verify feat chat finishers ticket claims before merge

**Status:** Not Started
**Priority:** high
**Effort:** Small
**Tags:** verification

**Summary:**

Target: loop-lore branch feat-chat-finishers.

Two loop-lore tickets were closed in the shared git-issue registry by the feat-chat-finishers agent, and their `Status: Done` was carried into worktree p3-verify-close-batch by commit 12403fdc3 with no verification by the filing agent:

```text
TASK-chat-feature-component-buttons
TASK-chat-feature-turn-talkativity-skip
```

(The identifiers are fenced because this repo's links gate treats a bare `TASK-` token in a .plan file as a local ticket ref.)

Acceptance: for each of the two tickets, a file:line or commit reference recorded in the ticket Context section proving the acceptance criteria are met on feat-chat-finishers and land on dev; re-open both issues where that cannot be shown. Neither ticket may ship asserted Done on registry alone.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
