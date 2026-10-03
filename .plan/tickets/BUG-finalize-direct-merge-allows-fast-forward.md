<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize direct merge allows fast-forward — no merge commit created

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** finalize, merge

**Summary:**

`executeMergeStep` for the `direct` strategy in `src/commands/finalize/merge-exec.ts:175-183` uses `git merge --no-edit` which allows fast-forward. A "direct merge" that fast-forwards doesn't create a merge commit, which may be surprising to the user who expects a merge commit.

**Context:**

```ts
// src/commands/finalize/merge-exec.ts:175-183
const mergeResult = Bun.spawnSync([
  "git",
  "-C",
  config.repoRoot,
  ...flags,
  "merge",
  branch,
  "--no-edit",
], { env: isolatedGitEnv(), stdout: "pipe", stderr: "pipe" });
```

The `--no-edit` flag allows the merge to use the default message, but doesn't prevent fast-forward. If the user wants a merge commit, they should use `--no-ff`. This might be intentional (fast-forward is preferred when possible) but should be documented or made explicit.

**Acceptance Criteria:**

- [ ] The direct merge strategy documents whether fast-forward is allowed
- [ ] Or: add a `--no-ff` flag to force a merge commit
- [ ] A regression test covers the fast-forward case
