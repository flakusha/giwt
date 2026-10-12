<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: Expose file-size check via public API

**Status:** Done
**Priority:** medium
**Effort:** Medium

**Summary:**

scripts/check-file-size.ts contains the file-size check logic. Loop-lore needs to import this function directly from giwt's src/index.ts public API rather than shelling out to the CLI or reaching into node_modules. Export the core check function (and its result type) from src/index.ts.

**Context:**

Loop-lore needs to import the file-size check directly rather than shelling out to the CLI. The logic already lives in `scripts/check-file-size.ts`; the lazy approach is a re-export shim (`src/utils/check-file-size.ts`) so no logic is duplicated and `src/index.ts` exposes the public API surface. `scripts/check-file-size.ts` stays as-is — it remains the source of truth and continues to work as a standalone script.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
