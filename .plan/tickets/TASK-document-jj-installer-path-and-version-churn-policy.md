<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: document jj installer path and version churn policy

**Status:** Not Started
**Priority:** low
**Effort:** Small
**Tags:** jj
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Related:** FEAT-jj-audit-backup-and-version-policy.md

**Summary:**
The jj 0.46 version floor is enforced in code (`src/vcs/jj.ts`, `src/doctor/check/jj.ts`) and AGENTS.md notes the floor, but the accepted decision also requires a pinned installer path and a documented monthly-breaking-release policy (including GURU-vs-musl ambiguity). No doc currently covers it.

**Acceptance Criteria:**

- [ ] Document the pinned jj installer path/artifact for this workstation and the reason for pinning it.
- [ ] Document the jj 0.46 floor plus the monthly-breaking-release churn and upgrade policy; link from AGENTS.md.

**Context:**
Documentation only; the code guard already lands. Keep AGENTS.md as the canonical pointer rather than adding a second install guide.
