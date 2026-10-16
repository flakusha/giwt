<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: Ship a consumer-runnable conformance suite (giwt selftest) for repos that delete their local fork

**Status:** Done
**Priority:** medium
**Effort:** Medium

**Summary:**

loop-lore's deleted scripts/worktree fork shipped with tests/worktree-flow.test.ts: 47 scenarios driving finalize/rebase/commit flows against fixture repos, executed by bun test inside the consumer repo. That was the only consumer-side exercise of the orchestration machinery. After the fork's deletion (loop-lore scripts-migration-delete), bun test excludes node_modules, so the pinned giwt copy's behavior is unverifiable in the consumer's environment; giwt's own suite runs only in the giwt repo, against master — not against the consumer's bun.lock pin. Coverage loss is recorded verbatim in loop-lore's CHANGELOG. Suggested: a `giwt selftest` command (optional `--filter <suite>`) — or an exported test-kit entry point — that runs the shipped suites against the installed copy in the consumer's environment, with a pass/fail exit code so consumers can wire it into their check runner. Verified: no selftest/conformance command in the 44-command registry, and no existing ticket.

**Context:**

Constraints: the runner must not require the consumer to vendor giwt's test
dependency trees; per-file isolation carried by `bun test --isolate` already
exists and should be reused; a non-zero exit must name the failing suite so
triage stays one command away. Alternatives considered: documenting "trust the
pin" (no verification), or asking consumers to keep a fork (the thing this
migration removes).

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
