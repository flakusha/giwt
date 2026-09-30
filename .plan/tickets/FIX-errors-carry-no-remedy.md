<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: errors carry no remedy

**Status:** Done
**Priority:** medium
**Effort:** Small

**Summary:**

Symptom: giwt errors state the failure but not the fix, forcing agents to rediscover valid inputs by trial.

**Context:**

Evidence (2026-09-18):

- `giwt new tooling-plan-validate-integration` in the giwt repo (which branches from master) @ 01:25:03: "error: base 'dev' does not exist" — default root branch is dev (settings default), the repo has no dev, and the error lists no candidates and no giwt.toml hint. Agent worked around by passing master explicitly after inspection.
- Stale finalize lock @ 01:39:45 and @ 02:08:01: "error: could not acquire lock" — no PID, no age, no liveness, no `giwt abort` hint. The agent had to eval-stat the lockfile and check the PID manually before clearing it.
- `giwt merge dev skip-heavy-db` @ 00:53:03: "no worktree found for branch 'dev'" — merge targets worktrees only, but the error does not say so or offer the create+finalize path.

Acceptance:

- new: when the configured/default base ref is missing, list existing candidate bases and mention [branches] root override in giwt.toml.
- lock errors: print lock path, PID, age, alive/dead, and the recovery command.
- merge on a non-worktree target: explain the worktree-only contract and suggest create+finalize.
- Convention: every user-facing error string names at least one actionable next step.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
