<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize teardown branch deletion -d to -D fallback is silent — discards unmerged commits without warning

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** finalize, teardown, data-loss

**Summary:**

`teardownFinalizedWorktree` in `src/commands/finalize/teardown.ts:38-53` tries `git branch -d` first, and on failure silently falls through to `git branch -D` (force delete). The user is never told that unmerged commits are being discarded. The `-d` failure reason (e.g., "not fully merged") is not surfaced.

**Context:**

```ts
// src/commands/finalize/teardown.ts:38-53
const deleteResult = Bun.spawnSync(["git", "-C", config.repoRoot, "branch", "-d", branch], {
  env: isolatedGitEnv(),
  stdout: "pipe",
  stderr: "pipe",
});
if (deleteResult.exitCode === 0) {
  log("success", "Branch deleted");
} else {
  // Force delete
  Bun.spawnSync(["git", "-C", config.repoRoot, "branch", "-D", branch], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  log("success", "Branch deleted (forced)");
}
```

The `-d` failure stderr is captured but never logged. The user sees "Branch deleted (forced)" with no indication that commits were lost. This is especially dangerous when the merge strategy was `direct` and the merge had conflicts that were resolved but not committed, or when the branch has commits that were never merged.

Compare with `src/commands/remove.ts`: `execute` (lines 91-99) checks `branchMerged()` and keeps unmerged branches; `removeBranchOnly` (lines 175-195) refuses unmerged deletion without `--force` and reports the tip SHA so the commit stays recoverable from the reflog.

**Acceptance Criteria:**

- [ ] The `-d` failure reason is logged before falling through to `-D`
- [ ] A warning is printed that unmerged commits are being discarded
- [ ] The tip SHA is reported so the commit stays recoverable from the reflog
- [ ] A regression test asserts the warning is printed
