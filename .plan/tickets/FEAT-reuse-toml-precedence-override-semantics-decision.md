<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: REUSE.toml precedence override semantics decision

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** spdx, licensing, decision

**Summary:**

REUSE.toml `precedence` is parsed but ignored: rule selection is first-match. Decide
and implement REUSE override semantics (`precedence = "override"` rules beat
aggregate rules) or document nearest-REUSE.toml/first-match as the final, intentional
behavior.

**Context:**

Deferred decision (followup to the 2026-10-14 proposals sweep; not covered by P1-P8).

Evidence (read from source):

- `parseReuseToml` parses and stores `precedence` per rule, defaulting to
  `"aggregate"` (src/utils/reuse-toml.ts:69-71: `const precedence =
  extractString(block, "precedence") ?? "aggregate"`), and `ReuseRule` carries it
  (reuse-toml.ts:20); reuse-toml.test.ts:38-47 tests that it parses.

- But selection ignores it: `generatedHeader` (src/utils/reuse-toml.ts:153-169) does
  `.find((r) => r.matchers.some((m) => m.test(rel)))` (line 161) — first matching rule
  in file order wins, `precedence` never consulted. The doc comment (lines 146-152)
  documents nearest-REUSE.toml-wins, parent rules not merged — but says nothing about
  override.

- Downstream the same selection feeds generated-file headers: `giwt plan matrix`
  (src/commands/matrix.ts:54), `giwt plan gen-docs` (gen-docs.ts:38), ticket creation
  (src/commands/ticket/create.ts:137), feature-matrix (src/plan/feature-matrix.ts:244),
  validate gates (plan/validate/content-gates.ts:205, matrix-gate.ts:34,61).

- REUSE spec background: `precedence = "override"` means the rule replaces
  (rather than aggregates with) matching rules — a consumer relying on override
  semantics today silently gets the first rule instead.

Decision to make:

- Option A (implement): when several rules in the same REUSE.toml match, an
  `override`-precedence rule wins over `aggregate` rules (last override wins among
  overrides); document in generatedHeader's doc comment and reuse-toml.test.ts.

- Option B (document): keep first-match, remove/ignore the parsed field, and state in
  the doc comment + tests that `precedence` is deliberately not honored (nearest
  REUSE.toml, file order).

**Acceptance Criteria:**

- [ ] A decision is recorded in this ticket (comment or status note) with rationale
- [ ] If Option A: a REUSE.toml with two matching rules (aggregate + override) resolves the header from the override rule; covered by a unit test in reuse-toml.test.ts
- [ ] If Option B: `generatedHeader`'s doc comment states first-match-is-final; `precedence` parsing is either removed or annotated as inert; test asserts the documented behavior
- [ ] Either way: `bunx tsc --noEmit` clean; `bun test src/utils/reuse-toml.test.ts` green; validate spdx gate unaffected
