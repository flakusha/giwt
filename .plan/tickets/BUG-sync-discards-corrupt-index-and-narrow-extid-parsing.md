<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: sync discards corrupt index and narrow extid parsing

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** sync, registry
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`readIndex` used to degrade a corrupt `index.json` to `{}`, letting `--fix` rebuild it from .md files and silently drop phantom entries; it now throws with the path and cause, matching `ticket/lookup.ts`. Residual: two extid grammars disagree — resolver.ts `extractExtid()` requires `<EXTID>:` while sync-registry.ts indexes titles matching `^(TASK|FEAT|…)-[a-z0-9-]+` without the colon. Export one shared parser from the registry and consume it in the resolver so registry-visible issues are addressable.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
