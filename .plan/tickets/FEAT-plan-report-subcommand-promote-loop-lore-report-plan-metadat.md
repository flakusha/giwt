<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: plan report subcommand - promote loop-lore report-plan-metadata into src/plan

**Status:** Done
**Priority:** medium
**Effort:** Large
**Tags:** plan, reporting

**Summary:**

Problem: loop-lore carries scripts/plan/report-plan-metadata.ts as a local fork of plan reporting that belongs in giwt. Reference implementation plus 9 tests exist in loop-lore (scripts/plan/report-plan-metadata.ts and its .test.ts, loop-lore commit 125de192).

Scope: add a giwt plan report subcommand with subactions: aggregate (default), tags `<tag>`, epic `<epic-id>`, orphans; --json output; exit 0 on success, 1 on usage error. Port the loop-lore implementation - do not reinvent. Reuse src/plan/status-vocab and the sync-parse field parsers so there is one parsing implementation. After the pinned dep ships, loop-lore copy shrinks to a thin wrapper or is deleted.

Acceptance criteria:

- [ ] giwt plan report aggregate|tags `<tag>`|epic `<id>`|orphans works, --json supported, exit codes 0/1
- [ ] Parsing reuses sync-parse field parsers and status-vocab (no second parser)
- [ ] Ported tests pass (mirror the 9 loop-lore tests)
- [ ] loop-lore wrapper/deletion path documented

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
