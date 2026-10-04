<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize teardown doesnt verify worktree exists — confusing error on externally-removed worktree

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** finalize, teardown

**Summary:**

`teardownFinalizedWorktree` in `src/commands/finalize/teardown.ts:15-62` does not check if the worktree path still exists. If the worktree was removed externally between the merge and the teardown, `git worktree remove` fails with a confusing error. The branch deletion still proceeds, which may be unexpected.

**Context:**

```ts
// src/commands/finalize/teardown.ts:22-34
log("info", "Step 6: Removing worktree...");
const removeResult = Bun.spawnSync(["git", "worktree", "remove", wtPath, "--force"], {
  env: isolatedGitEnv(),
  stdout: "pipe",
  stderr: "pipe",
  cwd: config.repoRoot,
});
```

The teardown should verify the worktree path exists before attempting removal, and handle the "already removed" case gracefully.

**Acceptance Criteria:**

- [ ] Teardown checks if the worktree path exists before attempting removal
- [ ] If the worktree is already gone, a clear message is printed
- [ ] The branch deletion step handles the missing-worktree case correctly
- [ ] A regression test covers the externally-removed case

git issue: e59a82b
