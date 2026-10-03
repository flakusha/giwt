<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize branchToPath is lossy — feature/foo and feature-foo map to same directory

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** finalize, worktree, naming

**Summary:**

`branchToPath` in `src/utils/config.ts:98-100` uses `branch.replace(/\//g, "-")` which converts `feature/foo` to `feature-foo`. Two branches `feature/foo` and `feature-foo` map to the same directory. This causes confusion and potential data loss if both branches exist.

**Context:**

```ts
// src/utils/config.ts:98-100
export function branchToPath(branch: string): string {
  return branch.replace(/\//g, "-");
}
```

The conversion is lossy — there is no reverse mapping. If a user has both `feature/foo` and `feature-foo` branches, they will collide in the tree directory. The second worktree creation will fail or overwrite the first.

**Acceptance Criteria:**

- [ ] `branchToPath` uses a reversible encoding (e.g., URL encoding or a mapping table)
- [ ] Or: the collision is detected and reported
- [ ] A regression test covers the collision case
