<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: jj (Jujutsu) VCS support

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, jj
**Related:** FEAT-feat-vcs-backend-seam-and-backend-setting.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Research dossier: `.tmp/research/jj/` (NOTES.md, INVENTORY.md, OPEN-QUESTIONS.md - 19 human-decision questions).

Key findings:

- Colocated-first phase-1 recommendation (workspaces; child-workspace git-worktree colocation requires jj 0.46+).
- Signing via `[signing]` config - jj ignores git config.
- No hooks: Co-Authored-By strip must be wrapper-level.
- Op log as abort/undo replacement.
- `giwt jj` RO/RW/BLOCK passthrough; new bypass surfaces: `--ignore-immutable`, `--at-op`, `JJ_CONFIG`.
- Re-key skip ledger on change IDs.
- jj run exit-code defect -> keep giwt's own bounded gate pool.
- Version floor: 0.46; workstation has jj 0.46.0.

**Context:**

**Prerequisite: the VCS seam.** This ticket is the **jj backend implementation**;
the interface, the backend registry and the `[vcs] backend` setting live in
`FEAT-feat-vcs-backend-seam-and-backend-setting.md`. That ticket lands the seam, the
`git` backend (byte-identical), the registry, the setting, and the first read-only
adoption (`giwt branches`); this ticket adds the `jj` backend behind the same
interface plus the `giwt jj` passthrough. Do not define a second abstraction here.

Verified against this tree (giwt @ `fb23aa5`), design input
`.tmp/research/implementation-vcs-seam-slice1.md`:

- **134 git argv call sites across 62 production files** (the earlier plan's "164" is
  wrong): `rg --stats -g '!*.test.ts' 'gitSync\(|gitSyncQuiet\(|spawnSync\(\["git"' src`
  -> 134 matches / 62 files.
- The exec helper lives in `src/utils/git.ts` (`gitSync`, `gitSyncQuiet`,
  `isolatedGitEnv()`); there is **no generic argv exec helper**, so the jj backend
  needs its own argv spawn with an injectable exec seam (precedent:
  `src/intercom/backend-pijul.ts`).
- The config/settings layer is git-bound (`findRepoRoot()` ->
  `git rev-parse --git-common-dir`), so **jj support in phase 1 means a COLOCATED jj
  repo**. A non-colocated jj repo cannot even load config today.

## jj 0.46 facts that change the design (verified locally against jj 0.46.0)

- There is **no `jj branch` command in 0.46** - bookmarks replaced it
  (`jj bookmark`, alias `b`). Any wording that says "jj branch" means bookmark
  semantics.
- jj's base is **`trunk()`**, not git's root branch (git's base is the main
  checkout's current branch, `getRootBranch`). Each backend resolves its own base;
  do not push a base ref into the shared interface.
- **`jj workspace add` does NOT create a bookmark** (corrected against jj 0.46.0:
  after `jj workspace add`, `jj bookmark list` shows only `main`,
  `jj log -r feature` reports "revision does not exist", and the colocated git
  `refs/heads` shows only `refs/heads/main`; the upstream v0.46.0 sources contain
  no bookmark creation on that path). A jj workspace therefore needs an **explicit
  `jj bookmark create`** to get a branch analogue - the earlier design note's claim
  that the workspace add also creates the bookmark is WRONG. The seam's
  `createWorkspace` op therefore maps to `jj workspace add` **plus** an explicit
  `jj bookmark create` for the branch/bookmark convention.
- **`jj commit` acts on `@` only** (no `-r`) and is describe + new, so the recorded
  change ends up at **`@-`**. A seam `commit` must read the sha from `@-`, not `@`.
- **There is no jj template keyword for a workspace's target commit** -
  `jj workspace list -T` exposes `name` and `root` only; `target.…` is a template
  parser error. The shared interface therefore carries **no `head` field** (it would
  be a permanent `""` for jj).

## argv mapping (jj side of the seam)

| seam operation | jj argv |
| --- | --- |
| `listBranches(root)` | `jj bookmark list -T 'name ++ "\n"'` and `jj bookmark list -r @ -T 'name ++ "\n"'` (the second marks the "current" bookmark = the one at `@`) |
| `listWorkspaces(root)` | `jj workspace list -T 'name ++ "\t" ++ root ++ "\n"'` (name = workspace/branch name, root = absolute path) |
| `status(root, branch)` | `jj log -r 'trunk()..<branch>' --count`, `jj log -r '<branch>..trunk()' --count`, `jj diff --summary -r @` (base = `trunk()`; clean = empty diff summary) |
| `commit({cwd,message})` | `jj commit -m <message>` then `jj log -r @- --no-graph -T 'commit_id ++ "\n"'` |
| `createWorkspace({root,path,branch,base})` | `jj workspace add <path> --name <branch> [--revision <base>]` **plus an explicit `jj bookmark create <branch>`** (the workspace add does NOT create the bookmark - see Context) |
| binary missing | clear error (`jj not found on PATH - install jj (>= 0.46) or set [vcs] backend = "git"`), **never** a git fallback |

All argv are argv arrays - never a shell string. jj runs with the same env isolation
the git helpers use (`isolatedGitEnv()`).

## `giwt jj <args>` passthrough policy

New command key `jj` (`src/commands/jj.ts`), registered in `src/cli-commands.ts` +
`src/cli-usage.ts`, mirroring the `giwt git` passthrough shape: classify -> spawn
with argv -> capture stdout+stderr into the run record (`jj-output.txt`) -> relay
stdout on stdout and stderr on stderr -> exit code is jj's.

Classification order:

1. bypass flags (anywhere in argv) -> block
2. bypass env vars -> block
3. global options (jj's globals come before the verb): unknown global -> block;
   `--config` key refusals -> block; `--config-file` -> block
4. blocked verbs (destructive) -> block
5. unclassified verbs -> block
6. otherwise -> **pass** (forwarded; jj itself rejects verbs it does not know)

Deny-list (blocked verbs):

| verb | why |
| --- | --- |
| `util gc` | backend garbage collection - pairs with `op abandon` to prune unreachable objects (irreversible) |
| `op abandon` | truncates the operation/evolution history |
| `workspace remove` | deletes the workspace directory, ignored files included |
| `workspace forget` | forgetting *other* workspaces; giwt cannot tell whose is whose, so it refuses the whole verb |
| `git init` / `git clone` | replaces the backing store |
| `git colocation enable` / `git colocation disable` | restructures the backing store ↔ git worktree |
| `fix` | payload comes from `fix.tools.*.command` in config, not from argv - the `hook:`-style arbitrary-code class |

Unclassified verbs (default-refuse until triaged): `bisect`, `diffedit`, `sparse`,
`gerrit`, `util backend`.

Bypass shapes (block on any command):

- flags: `--ignore-immutable`, `--at-operation` / `--at-op`, `--no-integrate-operation`
- `jj run --ignore-changes` (runs the payload on immutable commits)
- `--config` keys refused regardless of value: `signing.behavior`, `signing.backend`,
  `user.name`, `user.email`, `git.private-commits`,
  `git.abandon-unreachable-commits`, `revset-aliases."immutable_heads()"`,
  `fix.tools.*`, `merge-tools.*`, `ui.editor`, `ui.diff-formatter`
- `--config-file <PATH>` (arbitrary config file)
- env vars: `JJ_CONFIG` (replaces the whole user config set), `JJ_USER`, `JJ_EMAIL`

Allowed globals (everything else -> block as unknown): value-taking
`--repository` / `-R`, `--color`; standalone `--ignore-working-copy`, `--debug`,
`--quiet`, `--no-pager`, `-h`/`--help`, `-V`/`--version`.

The full RO/RW/BLOCK table is transcription work, not research - the dossier
(`.tmp/research/jj/NOTES.md` section 6) already classifies every 0.46 verb. The
deny-list above is the minimum viable policy; the full table is the follow-up.

Candidate classification carried over from the exploratory pass (source of truth is
the dossier; verify each row against NOTES.md section 6 before shipping):

- RO prefixes: `status`, `log`, `show`, `diff`, `interdiff`, `evolog`, `op log`,
  `op diff`, `op show`, `file show`, `file list`, `file annotate`, `file search`,
  `bookmark list`, `tag list`, `workspace list`, `workspace root`, `git root`,
  `git colocation status`, `config list`, `root`, `version`, `help`,
  `util completion`, `util config-schema`, `util diff`, `util markdown-help`.
- RW prefixes: `new`, `commit`, `describe`, `metaedit`, `split`, `squash`,
  `absorb`, `restore`, `rebase`, `revert`, `duplicate`, `abandon`, `parallelize`,
  `sign`, `unsign`, `edit`, `next`, `prev`, `resolve`, the `bookmark *` family
  (`create`, `set`, `move`, `track`, `untrack`, `rename`, `delete`, `forget`,
  `advance`), the `tag *` mutators (`set`, `delete`, `track`, `untrack`),
  `git fetch`, `git export`, `git import`, `git push`, `git remote add`,
  `git remote remove`, `git remote set-url`, the `file *` mutators (`chmod`,
  `delete`, `edit`, `track`, `untrack`), `workspace add`, `workspace forget`,
  `workspace rename`, `workspace update-stale`, `fix`, `run`,
  `simplify-parents`, `converge`, `arrange`, `util snapshot`, `op integrate`,
  `op revert`, `undo`, `redo`, `config set`, `config edit`,
  `util install-man-pages`.
- Additional BLOCK rows beyond the deny-list above: `op restore` (rewinds the
  operation history), `util exec` (arbitrary code execution), `util backend`
  (swaps the backend implementation).
- Not op-log reversible, therefore treated as RW-with-care: `git push`, the
  `git remote *` family, `config set`/`config edit`, `util install-man-pages`
  (they touch a remote, config files outside the repo, or the filesystem).
- Refused env vars: `JJ_CONFIG`, `JJ_USER`, `JJ_EMAIL`, `JJ_EDITOR` (the last
  one replaces jj's editor).

**Acceptance Criteria:**

- [ ] `JjBackend` implements the seam's five ops with the exact argv sequences
      above; the suite asserts the argv (injected exec - jj must NOT be required
      on PATH for the unit tests)
- [ ] `jj commit` reads the recorded change from `@-` (not `@`); `jj workspace add`
      is followed by an explicit `jj bookmark create` (the workspace add creates no
      bookmark); the base revset is `trunk()`
- [ ] No `head` field on the shared interface (jj cannot answer it)
- [ ] `jj` missing on PATH produces a clear, actionable error and **never** falls
      back to git
- [ ] `giwt jj <args>` passthrough: the deny-list, the bypass shapes, the
      `--config`/env refusals and the allowed globals are enforced and tested;
      stdout/stderr are relayed and jj's exit code is propagated
- [ ] The seam's write ops stay raw VCS primitives; giwt's identity/GPG policy and
      the Co-Authored-By strip (wrapper-level - jj has no hooks) stay in the
      command layer
- [ ] The repo's own gates pass (`bun run check`: fmt, oxlint, markdownlint,
      knip, jscpd, size, `tsc --noEmit`, coverage ratchet); every new file carries
      the SPDX header
- [ ] A test proves the adopted command's git output is unchanged (byte-identical
      `git` backend output for the command adopted by the seam ticket)

**Not in this ticket:** the finalize/rebase/abort family rewrite onto jj's op log,
jj signing translation, the skip-ledger re-key on change IDs, remotes/push/fetch,
tags, per-backend hook install, and non-colocated jj repos.
