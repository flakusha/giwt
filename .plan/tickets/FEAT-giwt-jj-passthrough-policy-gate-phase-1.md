<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: giwt jj passthrough policy gate (phase 1)

**Status:** Done
**Priority:** medium
**Effort:** small
**Tags:** jj, passthrough
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Phase-1 jj support derived from the audited dossier at .tmp/research/jj/ (NOTES, INVENTORY, OPEN-QUESTIONS, AUDIT JJ-1..JJ-3). Build a safety-gated giwt jj passthrough mirroring giwt git: RO/RW/BLOCK classifier covering every jj 0.46 verb, longest-prefix nested command matching, refusal of bypass tokens (--ignore-immutable, --at-op, --no-integrate-operation, run --ignore-changes) anywhere in argv, refusal of identity/config/code-executing override keys (JJ-2/JJ-3), --config-file refusal, [jj] safe/allow/deny settings, run-record capture, CLI/usage/public-API wiring, and behavior tests. Broader jj integration (workspaces, signing, finalize, audit, backup) is tracked in the jj roadmap ticket.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
