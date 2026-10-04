<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: zero-shot command classifier seam (prepare only)

**Status:** Done
**Priority:** low
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, classifier

**Summary:**

classifyGitInvocation(args, policy) is the stable seam; [git] classify setting reserved (only builtin accepted now, llm rejected with clear error). Future: LLM 0-shot classifier of unknown subcommands/aliases behind same interface, builtin fallback on failure. Not built in this pass.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-04T02:00:46.867Z Landed: classifyGitInvocation seam + [git] classify reserved, only builtin accepted; classify=llm exits 1 'not supported yet' (git.test.ts:253)
