<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: remove path auto-detection matches main worktree registration

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** cli, worktree

**Summary:**

`giwt remove <path>` (e13b449) uses `registrationFor(config.repoRoot, target)` to detect path targets. `git worktree list` includes the main worktree with `path=<repoRoot>` and `branch=refs/heads/<current>`. So `giwt remove /home/flak/git-ai/giwt` (the repo root) matches the main registration, passes the dirty check, then `git worktree remove <repoRoot>` fails with git's raw "is a main working tree" error. No data loss, but the error is a raw git message with no remedy.

**Context:**

`src/commands/remove.ts:44`:

```ts
const pathMatched = await registrationFor(config.repoRoot, target);
```

`registrationFor` -> `findRegistration` -> `worktrees.find((wt) => resolve(wt.path) === want)`. The main worktree is listed by `git worktree list` with `path=<repoRoot>`. So when `target === repoPath`, `pathMatched` is the main worktree registration.

Then:

- `wtPath = resolve(pathMatched.path)` = repoRoot
- `branch = "main"` (from `refs/heads/main`)
- `hasWorktreeDir(repoRoot)` = `existsSync(repoRoot/.git)` = true
- Dirty check passes (or blocks if dirty)
- `git worktree remove <repoRoot>` -> git refuses: `fatal: '<path>' is a main working tree`
- Exit 1 with raw git error

**Evidence:**

`git worktree list` output includes:

```text
/home/flak/git-ai/giwt  e13b449 [main]
```

So `resolve("/home/flak/git-ai/giwt")` matches the main worktree's `.path`.

**Consequence:**

Confusing UX: `giwt remove /path/to/repo` (a reasonable thing to try) produces a raw git error instead of a clear message like "cannot remove the main worktree — target a branch inside tree/ instead". The `--force` flag does nothing (git always refuses main worktree removal regardless).

**Suggested fix direction:**

In `registrationFor` or in `remove.ts`, skip the main worktree registration: if `resolve(wt.path) === resolve(repoRoot)`, return undefined. Or in `remove.ts`, add an explicit check: if `wtPath === config.repoRoot`, log a clear error and exit.

**Acceptance Criteria:**

- [ ] `giwt remove <repoRoot>` produces a clear error (not raw git "main working tree")
- [ ] `git worktree remove <repoRoot>` is never spawned
- [ ] Path-targeted removal of non-main worktrees unchanged
- [ ] Test covers the main-worktree-as-path case

**Not a duplicate:**

`BUG-giwt-remove-cannot-target-a-worktree-by-path-only-by-branch` covers the path-detection feature. This ticket covers an edge case in that feature's implementation.

git issue: ef0e231
