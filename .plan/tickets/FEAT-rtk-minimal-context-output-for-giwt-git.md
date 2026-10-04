<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: rtk minimal-context output for giwt git

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, rtk

**Summary:**

When rtk available ([git] rtk=auto default): full raw git stdout+stderr saved to run capture; RO subcommands in rtk compact set (diff/log/status/show/branch/worktree) additionally get an rtk git args display pass; rtk failure falls back to raw; rtk=off prints raw bytes.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-04T02:00:46.775Z Landed: writeConsole in src/commands/git.ts + RTK_DISPLAY_SUBCOMMANDS, [git] rtk auto|on|off (invalid warns as auto, off prints raw); git.test.ts rtk cases
