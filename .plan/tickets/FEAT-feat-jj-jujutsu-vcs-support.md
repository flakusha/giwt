<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj (Jujutsu) VCS support

**Status:** In Progress
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, jj
**Related:** FEAT-feat-vcs-backend-seam-and-backend-setting.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Implement the `jj` backend behind the landed VCS seam (`src/vcs/{types,registry,git}.ts`) plus the `giwt jj` err-closed passthrough. Full research: `.tmp/research/jj/` (NOTES, INVENTORY, OPEN-QUESTIONS).

**Decisions (2026-11-18, user-approved):**

- Both native backends are in scope; jj topology is **colocated-only** — the backing git store stays the substrate for git-issue, audit and hot backups; no pure-jj/non-colocated repo support.
- Config loading is git-bound (`findRepoRoot()` → `git rev-parse --git-common-dir`), so colocation is a hard prerequisite, not a preference.
- jj 0.46 argv facts that constrain the backend: no `jj branch` (use `bookmark`); `jj workspace add` creates no bookmark (explicit `jj bookmark create` needed); `jj commit` records at `@-`; base revset is `trunk()`; no workspace-target template keyword, so the seam carries no `head` field.
- Signing uses `[signing]` config (jj ignores git config); no hooks, so the Co-Authored-By strip stays wrapper-level. A missing jj binary never falls back to git.
- Colocation is detected by `jj git colocation status` output text (`is currently colocated with Git.`; exit code is 0 in both states), never by the inverted `.jj/repo/store/git` path. Hard version floor 0.46; older jj refuses before any op. Direct git mutations in a jj-mode repo are refused — jj owns the op log and signing.
- Per-agent isolation in a colocated jj repo must use `jj workspace`, not `git worktree` (a git worktree under the repo root is snapshotted as content by jj). The shared seam therefore gains `createWorkspace`/`removeWorkspace` primitives implemented by all three backends.

**Acceptance Criteria:**

- [ ] `JjBackend` implements all seam ops with an injectable exec argv seam; unit tests assert exact argv without jj on PATH.
- [ ] `commit` reads the sha from `@-`; `listBranches` maps bookmarks; `listWorkspaces` maps workspaces; base is `trunk()` with a reported `main`/`master` fallback when no remote resolves it; no `head` field on the shared interface.
- [ ] `createWorkspace`/`removeWorkspace` use `jj workspace add` (+ explicit `jj bookmark create`) and `jj workspace forget`; the git backend keeps `git worktree add/remove`; tests assert exact argv and no cross-backend fallback.
- [ ] Colocation guard refuses a non-colocated repo with an actionable message; version floor 0.46 hard-refuses older jj; missing jj on PATH never runs git.
- [ ] `giwt jj <args>` enforces the landed err-closed policy (deny-list verbs, bypass flags/env, `--config`/`--config-file` refusals, allowed globals), relays stdout/stderr and propagates jj's exit code; `unsign` is BLOCK.
- [ ] Git-side mutation commands (`commit`, `commit-wt`, `merge`, `sign`, finalize merge, mutating `giwt git` passthrough) refuse in jj mode through one shared guard; identity/GPG policy and Co-Authored-By strip stay in the command layer.
- [ ] `.jj/` is excluded from hot backups with a loud warning; a doctor `jj` check reports backend/version/colocation.
- [ ] `bun run check` passes; every new file carries an SPDX header.

**Not in this ticket:** finalize/rebase/abort op-log rewrite, jj signing translation, skip-ledger re-key, remotes, tags, non-colocated repos.
