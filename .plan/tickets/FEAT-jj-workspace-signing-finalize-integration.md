<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj workspace signing finalize integration

**Status:** In Progress
**Priority:** medium
**Effort:** large
**Tags:** jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Broader jj integration after the policy gate, from `.tmp/research/jj/OPEN-QUESTIONS.md` #1, #2, #5–#14. Record decisions before code.

**Decisions (2026-11-18, user-approved):**

- jj is **colocated-only**: workspaces are jj workspaces on the colocated repo; the backing git store stays the substrate, and mutating git directly in a colocated repo is forbidden.
- The branch convention is **jj bookmarks** (`jj bookmark`, no `jj branch` in 0.46); the ledger branch field holds the bookmark name. Workspaces may be pinned; child-workspace colocation requires jj 0.46+.
- Signing uses jj `[signing]` config (jj ignores git config): identity mapping and signing bypass keys are explicit; no GPG funnel reaches jj.
- No hooks exist, so the Co-Authored-By strip stays wrapper-level and `jj fix` is gated like other code-execution payloads.
- Finalize/abort is **op-log-centered** (`op undo`/`op revert`, not git reflog/reset); `jj run` does not replace giwt's bounded gate pool (exit-code defect). Doctor gets a dev-sync analog.

**Acceptance Criteria:**

- [ ] Implement and test the workspace add/rename/forget/remove lifecycle and stale-WC policy on a colocated repo; direct git mutation is refused.
- [ ] Enforce the bookmark convention in branch listing and the ledger branch field; cover workspace pinning and 0.46+ child colocation with tests.
- [ ] Test signing identity mapping and bypass-key refusals; cover the Co-Authored-By strip and `jj fix` gating without relying on hooks. (partial: `signing.*` config overrides and `jj fix` are denied, command messages get the trailer strip; identity mapping remains)
- [x] Finalize/abort uses jj op-log undo/revert with tests for partial failure and rollback; giwt's bounded gate pool remains the gate substrate. (`finalize/jj.ts` snapshots an op, runs git-free bounded check gates, reverts on gate failure; abort/worktree-bootstrap/cleanup now refuse non-git backends before git stash surgery)
- [x] Add and test a doctor dev-sync analog (`jj-stale-workspace` finding from `jj workspace list`).
- [x] `bun run check` passes; docs updated; SPDX headers on new files.

**Not in this ticket:** skip-ledger re-key, backup exclusion mechanics, pijul work.
