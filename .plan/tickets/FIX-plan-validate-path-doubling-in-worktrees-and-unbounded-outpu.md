<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: plan validate: path doubling in worktrees and unbounded output

**Status:** Done
**Priority:** medium
**Effort:** Medium

**Summary:**

Symptom: plan validate joins an absolute path onto the root (breaking runs inside worktrees) and floods stdout with every issue instead of a summary.

**Context:**

Evidence (2026-09-18, minimax session 2026-09-18T01-15-39, loop-lore):

- 01:37:03 `giwt plan validate` from tree/tooling-plan-validate-integration: "error: Tickets directory not found: /home/flak/git-ai/loop-lore/tree/tooling-plan-validate-integration/home/flak/git-ai/..." — the absolute tickets path was concatenated onto the worktree root.
- 02:28:20 validate --gates format emits 8,185 missing-section lines across 2,422 files; the agent had to eval-count lines to grasp scope ("Major scope miscalibration").
- 02:29:18 `--fix` does not fix the format gate, silently.

Acceptance:

- Absolute path inputs are respected (isAbsolute check before join).
- Default output is summary-first: per-gate counts + first N issues + total; full listing behind a flag or --json.
- --fix either fixes the format gate or explicitly states which gates it cannot fix.
- Worktree smoke: validate from inside a worktree resolves the correct tickets dir.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
