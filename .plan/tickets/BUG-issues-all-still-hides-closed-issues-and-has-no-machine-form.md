<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: issues --all still hides closed issues and has no machine formats

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

issues.ts:70-72 builds ['issue','ls','--format',format] and uses showAll only for the local 50-cap, so --all never reaches git and closed issues stay hidden. Forward -a/--all to git issue ls. Add --json/--toml/--emoji via emit.ts plus the multi-output-flag warning. Regression: --all lists closed issues and --json emits parseable records. Related done ticket FIX-giwt-issues-silently-drops-state-so-closed-issues-are-unreac.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
