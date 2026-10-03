<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize findWorktree only checks `tree/<dirName>` — misses worktrees at custom paths

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** finalize, worktree, discovery

**Summary:**

`findWorktree` in `src/utils/config.ts:130-135` only looks in `config.treeDir` for a directory named `branchToPath(branch)`. If the worktree was created with a custom path (e.g., `git worktree add ../some-other-path branch`), it won't be found. The finalize command fails with "no worktree found for branch" even though the worktree exists.

**Context:**

```ts
// src/utils/config.ts:130-135
export function findWorktree(branch: string, config: WorktreeConfig): string | null {
  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);
  if (existsSync(resolve(wtPath, ".git"))) return wtPath;
  return null;
}
```

The function should also check `git worktree list` to find worktrees at custom paths. This is a known limitation but causes confusing failures when worktrees are created outside the default tree directory.

**Acceptance Criteria:**

- [ ] `findWorktree` falls back to `git worktree list` when the default path doesn't exist
- [ ] Worktrees at custom paths are found and finalized correctly
- [ ] A regression test covers the custom-path case
