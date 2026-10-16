<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: plan links derive and validate producers consumers siblings

**Status:** Not Started
**Priority:** high
**Effort:** Large
**Tags:** plan, interconnection, validation

**Summary:**

Problem: .plan/ already has ticket/epic/spec/frontend nodes and src/ ownership through code-map.json, but there is no derived producer/consumer/sibling graph and no gate that proves plan prose matches code ownership.

Scope: add src/plan/interconnect.ts; add giwt plan links with --write/--check/--json/--for/--who-produces/--who-consumes/--siblings; generate .plan/interconnect.json and .plan/interconnect.md; add a plan validate freshness gate. Reuse src/plan/src-refs.ts, src/plan/code-map.ts, src/plan/check-links/*, src/tickets/sync-parse.ts, and src/plan/index-projection.ts. Acceptance: deterministic byte-stable output; broken Related targets fail with file/field/path; shared src paths produce consumer/producer edges without guessing from titles; unit tests cover parser dialect, direction, determinism, freshness, and link validation; help text updated; public exports added deliberately.

Consumer: loop-lore .plan/ with 3473 tickets, 332 epics, and shared hubs such as src/db/schema-core.ts and src/routes/v1/actors-surface.ts.

**Possible Caveats and Issues to Avoid:**

- TOCTOU: `.plan/` files can change between graph read and `--check`; read once per run and fail if fingerprints diverge.
- Security: never follow links outside repo root; reject symlinked targets and absolute-path escapes in `Related` targets.
- Authorization: only write generated files from `--write`; default `plan links` is read-only and must never mutate ticket index.
- Parallelism: concurrent plan writers can invalidate index/code-map between reads; build from one immutable in-memory snapshot and report stale fingerprints instead of partial output.
- Lock/unlock lifecycle: do not hold finalize/gpg locks during graph scans; no global mutable cache that survives process exit.
- Partial failure: atomic write + temp/rename for `.plan/interconnect.json` and `.plan/interconnect.md`; never leave half-generated files.
- Rollback: preserve previous generated files on write failure and expose byte-level diff for `--check` failures.
- Stale plan states: derive Status from canonical vocab only; do not infer ownership from `Done` prose.
- Data races: dedupe edges deterministically without mutating shared maps during iteration.
- Idempotency: repeated `--write` must be byte-identical.
- Observability: name the file/path/edge that fails; no silent skips.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
