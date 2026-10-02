<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: rtk minimal-context output for giwt git

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, rtk

**Summary:**

When rtk available ([git] rtk=auto default): full raw git stdout+stderr saved to run capture; RO subcommands in rtk compact set (diff/log/status/show/branch/worktree) additionally get an rtk git args display pass; rtk failure falls back to raw; rtk=off prints raw bytes.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
