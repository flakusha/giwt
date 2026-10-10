<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: plan validate tickets gate reuses orphan-tag and orphan-binding detection

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** plan, tickets, plan-validate

**Summary:**

Problem: giwt plan validate has no gate for orphan tags or orphan epic bindings, even though the semantics already exist in loop-lore scripts/plan/report-plan-metadata.ts: an orphan tag is a tag on an index entry that no .md frontmatter declares (case-insensitive, placeholder tokens excluded); an orphan binding is an index epic value naming no .plan/epics/`<slug>`.md.

Scope: port the detection into src/plan/ and wire it as part of the tickets gate in plan validate. Advisory vs blocking: recommend advisory-first (warn, not fail) to avoid a red-gate cliff across existing repos - document the chosen policy in the gate output and docs.

Evidence of scale: the current loop-lore report shows 13 orphan tags and 149 orphan bindings - a blocking default would immediately red-gate every consuming repo.

Acceptance criteria:

- [ ] Detection ported to src/plan/ with semantics matching the loop-lore implementation
- [ ] Tickets gate reports orphan tags and orphan bindings
- [ ] Advisory/blocking decision implemented and documented
- [ ] Tests cover detection and gate integration

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
