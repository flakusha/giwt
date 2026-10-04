<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize step1 doesnt check untracked files — silent data loss on worktree removal

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** finalize, worktree, data-loss

**Summary:**

`runFinalize` Step 1 in `src/commands/finalize/run.ts:37-53` checks `git diff --quiet` and `git diff --cached --quiet` but does NOT check for untracked files. If the worktree has untracked files, the finalize proceeds, and `git worktree remove --force` in Step 6 silently discards them.

**Context:**

```ts
// src/commands/finalize/run.ts:37-53
const dirty = Bun.spawnSync(["git", "-C", wtPath, "diff", "--quiet"], {
  env: isolatedGitEnv(),
  stdout: "pipe",
  stderr: "pipe",
});
const staged = Bun.spawnSync(["git", "-C", wtPath, "diff", "--cached", "--quiet"], {
  env: isolatedGitEnv(),
  stdout: "pipe",
  stderr: "pipe",
});
if (dirty.exitCode !== 0 || staged.exitCode !== 0) {
  log("error", "uncommitted changes detected — commit or stash before finalizing");
  raw(`  cd ${wtPath} && git add -A && git commit -m 'feat: ...'`);
  raw(`  cd ${wtPath} && git stash`);
  process.exit(1);
}
```

Compare with `stashDevForMerge` in `src/commands/finalize/merge.ts:68-76` which explicitly checks `git ls-files --others --exclude-standard` for untracked files.

**Acceptance Criteria:**

- [ ] Step 1 checks for untracked files via `git ls-files --others --exclude-standard`
- [ ] Untracked files are reported in the error message
- [ ] A regression test covers the untracked-files case

git issue: 7aaa984
