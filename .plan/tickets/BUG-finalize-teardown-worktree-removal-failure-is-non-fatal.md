<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize teardown worktree removal failure is non-fatal — leaks worktree dir and admin entry

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** finalize, teardown

**Summary:**

`teardownFinalizedWorktree` in `src/commands/finalize/teardown.ts:30-34` logs a warning when `git worktree remove --force` fails but continues to Step 7 (branch deletion) and reports success. The worktree directory and its `.git/worktrees/<name>` admin entry leak. The finalize exit code is 0 (success) despite the teardown being incomplete.

**Context:**

```ts
// src/commands/finalize/teardown.ts:24-34
const removeResult = Bun.spawnSync(["git", "worktree", "remove", wtPath, "--force"], {
  env: isolatedGitEnv(),
  stdout: "pipe",
  stderr: "pipe",
  cwd: config.repoRoot,
});
if (removeResult.exitCode === 0) {
  log("success", "Worktree removed");
} else {
  log("warn", `Failed to remove worktree — remove manually: git worktree remove ${wtPath}`);
}
```

The warning is the only signal — no error exit code, no gripe appended to the ledger, no failure outcome in the run record. The user sees a success message and a warning they may scroll past. The leaked worktree directory and admin entry accumulate over time.

Compare with `src/commands/remove.ts:82-87` which exits 1 on worktree removal failure.

**Acceptance Criteria:**

- [ ] `teardownFinalizedWorktree` exits non-zero when `git worktree remove` fails
- [ ] The failure is recorded in the run record outcome and ledger gripe
- [ ] The branch deletion step is skipped when worktree removal fails (or at least warned about)
- [ ] A regression test asserts the non-fatal path

git issue: 854662b
