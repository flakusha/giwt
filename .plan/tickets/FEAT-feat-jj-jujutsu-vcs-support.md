<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj (Jujutsu) VCS support

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Research dossier: `.tmp/research/jj/` (NOTES.md, INVENTORY.md, OPEN-QUESTIONS.md — 19 human-decision questions).

Key findings:

- Colocated-first phase-1 recommendation (workspaces; child-workspace git-worktree colocation requires jj 0.46+).
- Signing via `[signing]` config — jj ignores git config.
- No hooks: Co-Authored-By strip must be wrapper-level.
- Op log as abort/undo replacement.
- `giwt jj` RO/RW/BLOCK passthrough; new bypass surfaces: `--ignore-immutable`, `--at-op`, `JJ_CONFIG`.
- Re-key skip ledger on change IDs.
- jj run exit-code defect → keep giwt's own bounded gate pool.
- Version floor: 0.46; workstation has jj 0.46.0.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
