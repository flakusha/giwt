<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: ledger field hygiene: wrong branch, empty branch, double append

**Status:** Done
**Priority:** medium
**Effort:** Small

**Summary:**

Symptom: the agent ledger (.ledger.jsonl under treeDir) records fields that do not match reality, weakening it as a cross-session source of truth.

**Context:**

Evidence (2026-09-18, giwt repo tree/.ledger.jsonl lines 1-4 vs run-record metas):

- doctor runs record branch:"check" — that is the subcommand, not the branch; the run meta says branch:"master".
- sync and abort entries record branch:"" even though the meta carries the real branch.
- commit-wt appends twice per run (begin line + outcome-enriched line with the same pid), e.g. pid 441496 at 01:30:53.

Acceptance:

- ledger branch always equals the branch from the resolved config/meta (subcommand never lands in the branch field).
- exactly one line per invocation; outcome enrichment updates or supplements deterministically instead of duplicating.
- unit test covering the append paths for doctor/sync/abort/commit-wt asserting the field values and line counts.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
