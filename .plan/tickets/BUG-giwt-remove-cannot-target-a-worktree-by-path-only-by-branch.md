<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt remove cannot target a worktree by path — only by branch

**Status:** Done
**Priority:** low
**Effort:** Medium
**Tags:** cli, worktree

**Summary:**

`giwt remove <branch> [--branch-only] [--force]` (src/commands/remove.ts:10-30) takes a BRANCH positional and resolves the worktree as `branchToPath(branch)` under the configured tree dir. There is no way to remove a worktree by its path, even though `git worktree remove <path>` is path-based. Consequence: an agent (or the omp `git` to `giwt` reroute hook) that holds a worktree PATH cannot delegate removal to giwt — it must either invert path to branch (lossy: `branchToPath` maps `feature/foo` to `feature-foo`) or fall back to plain `git worktree remove`.

**Context:**

Evidence: src/commands/remove.ts:37-38 (`const dirName = branchToPath(branch); const wtPath = resolve(config.treeDir, dirName);`) and the usage string `giwt remove <branch> [--branch-only] [--force]`.

The omp-plugins reroute hook (`plugins/oh-my-pi-integration/hooks/pre/git-giwt-reroute.ts`) previously mapped `git worktree remove <path>` to `giwt remove <path>` (broken — the path was treated as a branch); it now passes all `git worktree remove` shapes through to plain git. A path-accepting giwt form would let the hook delegate again.

**Acceptance Criteria:**

- [ ] Either (a) `giwt remove` accepts a worktree PATH (auto-detected: if the positional matches a registered worktree path, remove it; else treat as branch), or (b) a documented `--path` flag is added
- [ ] The usage string reflects the accepted input (branch and path)
- [ ] Tests cover both branch and path inputs
