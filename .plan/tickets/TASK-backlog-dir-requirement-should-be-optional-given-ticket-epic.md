<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: backlog dir requirement should be optional given ticket/epic auto-discovery

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Observed behavior: (1) `giwt plan validate` backlog gate emits a permanent warn when `.plan/backlog/` is absent (`src/plan/validate/content-gates.ts:23-29`, message `backlog dir not found`) — never clears, nothing to fix toward. (2) `giwt backlog sync` hard-errors on a missing dir (`src/commands/backlog.ts:59-61`, `throw ... missing backlog dir — nothing to sync`). Pass computation treats only error-level findings as failures (`src/plan/validate/gates-run.ts:75-90`), so the warn pollutes every validate run without failing the gate.

**Context:**

Expected: a repo with no `.plan/backlog/` dir gets a clean backlog-gate pass when tickets+epics carry priority metadata. Auto-discovery already reads `.plan/tickets/*.md` frontmatter plus `.plan/epics/*.md` (`src/tickets/sync-index.ts:74-78,122-128`), so priority derivation needs no tier files.

Suggested fix: treat a missing backlog dir as a clean skip (zero findings, or an info-level note), not a warn; make `backlog sync` no-op with an informational message (exit 0) instead of throwing. Keep error-level findings when the dir exists but is inconsistent.

Motivating consumer: sibling repo loop-lore landed branch `backlog-drop-tiers` as `45f343f5`, deleting its `.plan/backlog/` tier files; its `plan:priority` script derives the priority view from tickets+epics. The pinned giwt now warns on every validate there with no path to green.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
