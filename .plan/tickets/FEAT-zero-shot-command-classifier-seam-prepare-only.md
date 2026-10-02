<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: zero-shot command classifier seam (prepare only)

**Status:** Not Started
**Priority:** low
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, classifier

**Summary:**

classifyGitInvocation(args, policy) is the stable seam; [git] classify setting reserved (only builtin accepted now, llm rejected with clear error). Future: LLM 0-shot classifier of unknown subcommands/aliases behind same interface, builtin fallback on failure. Not built in this pass.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
