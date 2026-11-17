<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj workspace signing finalize integration

**Status:** Not Started
**Priority:** medium
**Effort:** large
**Tags:** jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Broader jj integration after the policy gate. Human decisions required from .tmp/research/jj/OPEN-QUESTIONS.md before implementation: #1 colocated-first vs pure jj; #2 forbid mutating git in colocated repos; #5 bookmark/branch convention and ledger branch field; #6 workspace add/forget/remove lifecycle and stale-WC policy; #7 pinned workspaces; #8 child-workspace colocation; #9 signing identity mapping (jj ignores git config); #10 signing bypass keys; #11 Co-Authored-By strip without hooks and jj fix gating; #12 op-log-centered finalize/abort; #13 jj run as gate substrate vs giwt bounded pool; #14 doctor dev-sync analog. Each decision must be recorded in the ticket before code is written.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
