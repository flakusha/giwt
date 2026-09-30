<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: isolatedGitEnv also strips agent-harness session vars

**Status:** Done (shipped: ISOLATED_ENV_STRIPPED_PREFIXES covers GIT_/OMP_/PI_/ENGRAM_/MNEMO_)
**Priority:** medium
**Effort:** Small
**Tags:** isolation, hooks, environment

**Summary:**

isolatedGitEnv (src/utils/git.ts:132-138) strips GIT_* only:

    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;

GIT_* is stripped for a specific, documented reason (git.ts:125-131): giwt's whole job is running inside git hooks, where hook-scoped context leaks into every call.

The same reasoning now applies to the agent harness. giwt is invoked by omp plugins and by agents (AGENTS.md documents agent-driven commit/finalize flows), and OMP_*/PI_*/ENGRAM_*/MNEMO_* session variables flow into those invocations and out through every gitSync, Bun.spawnSync, and every check subprocess giwt dispatches. A check that reads a session var takes a path a human shell never takes, so the local verdict diverges from CI.

**Context:**

Note this is a scope decision, not a no-op: the function is named for git isolation, and widening it changes what every existing caller inherits.

Evidence: src/utils/git.ts:125-138

Sibling omp-plugins already carries the matching change in `.githooks/gate-env.sh` (same five prefixes), so the two do not drift.

**Acceptance Criteria:**

- [x] The stripped prefix set is a single named constant (GIT_ plus the harness prefixes), not an inline literal
- [x] isolatedGitEnv drops OMP_*, PI_*, ENGRAM_*, MNEMO_* alongside GIT_*
- [x] The docstring is updated to state both reasons (git hook context, agent session context)
- [x] A test seeds one var per prefix and asserts each is dropped
- [x] Sibling omp-plugins hook does the same (companion ticket filed there) so the two do not drift

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
