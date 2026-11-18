<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj workspace lifecycle rename pinning and signing identity mapping

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Related:** FEAT-jj-workspace-signing-finalize-integration.md

**Summary:**
Close the remaining criteria of the jj workspace/signing follow-up that phase 2 left unchecked. `JjBackend` already implements createWorkspace/removeWorkspace (jj workspace add + explicit bookmark create, workspace forget), bookmark listing, version/colocation guards, and the command layer denies `signing.*` overrides and `jj fix`; missing pieces are the full workspace lifecycle and signing identity mapping.

**Acceptance Criteria:**

- [ ] Implement and test jj workspace rename plus stale-worktree policy on a colocated repo; direct git mutation stays refused.
- [ ] Enforce the bookmark convention in branch listing and the ledger branch field, with tests for workspace pinning and jj 0.46+ child colocation.
- [ ] Map jj `[signing]` identity from giwt identity config and test bypass-key refusals; keep the wrapper-level Co-Authored-By strip and `jj fix` denial covered.

**Context:**
Colocation is a hard prerequisite and jj owns the op log; no git worktree fallback or direct git mutation is acceptable in jj mode. Signing is `[signing]` config, not git config, and there are no hooks to enforce the trailer strip.
