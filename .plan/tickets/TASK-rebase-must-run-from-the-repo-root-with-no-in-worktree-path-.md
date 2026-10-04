<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: rebase must run from the repo root, with no in-worktree path for agents

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** cli, rebase, worktree, dx

**Summary:**
`rebase` is listed in `ROOT_ONLY_COMMANDS` (`src/cli.ts:69-76`), so invoking
it from inside a worktree exits 1 with a root-only message. Agents naturally
operate inside `tree/<branch>/`, so the command they need most while standing
in the worktree is the one they cannot run. Working from the root works, but
only by targeting the branch by name rather than by cwd.

**Context:**

Reported from loop-lore while trying to rebase the branch the agent was
currently standing in.

## Observed, verbatim

```text
error: command 'rebase' must be run from the repo root, not inside a worktree (tree/*)
  cd to the repo root and re-run: giwt rebase
```

Exit code 1, no git mutation attempted.

The wording is produced by `assertNotInWorktree` (`src/utils/git.ts:113-124`),
which formats `command '<name>' must be run from the repo root, not inside a
worktree (tree/*)` and then the remedy line `cd to the repo root and re-run: giwt
<name>`. Both lines are accurate and the remedy is actionable — the message is
not the problem.

## Scope: rebase yes, commit-wt no

`ROOT_ONLY_COMMANDS` is `cleanup, create, merge, new, rebase, remove`.
`commit-wt` is **not** in that table, so `giwt commit-wt` is unaffected and runs
from inside a worktree today — it resolves its target path from
`config.treeDir` + `branchToPath` rather than from cwd. The commit path an agent
takes most often works; only the rebase path is blocked.

The table comment (`src/cli.ts:63-68`) gives the rationale: these commands
"mutate worktree layout (create/rebase/remove/merge trees)" and
`finalize`/`agent-merge` are the documented exemptions because they resolve the
worktree from a branch argument. `rebase` takes a branch argument too — it
resolves `wtPath` via `findWorktree(branch, config)` at `src/commands/rebase.ts:60`
— so it is arguably in the same category as the exemptions, by its own logic.

## Questions to settle

1. **Is the root-only requirement necessary for `rebase`?** Its target path comes
   from the branch argument, not from cwd. Compare against `finalize`, which is
   exempt for exactly that reason. If `rebase` resolves identically, the guard is
   stricter than the stated rule and could be relaxed.
2. **Is the error clear enough?** It names the command, the reason, and the
   remedy. The gap is that it does not say *why* root matters for this command,
   or that the same work succeeds from the root — an agent reading it has to
   infer that `cd` first is enough.
3. **Same applies to `commit-wt`?** No — `commit-wt` is not root-only. Verified
   against the `ROOT_ONLY_COMMANDS` table.

## Suggested fix direction

Cheapest correct change: drop `rebase` from `ROOT_ONLY_COMMANDS`, since it
resolves its worktree from the branch argument exactly like the documented
`finalize`/`agent-merge` exemptions, and run the in-root tests that already exist
for `rebase` (`src/commands/rebase.test.ts`).

If the guard is kept, the cheaper alternative is to keep the refusal but improve
it — state that the same command succeeds from the root, and (for agents) name
the worktree the branch resolves to, so the caller can `cd` to the right place
once instead of guessing.

## Reproduction

From inside any worktree (`tree/<branch>`), run `giwt rebase <that-branch>`. It
exits 1 with the message quoted above. From the repo root, the same command
succeeds.

**Acceptance Criteria:**

- [x] Decide whether `rebase` genuinely needs root-only; record the decision and its rationale
- [x] If relaxed, drop it from `ROOT_ONLY_COMMANDS` and add a regression test that
      `giwt rebase` works when invoked from inside the worktree it rebases
- [x] If kept, the refusal message explains why root matters and names the resolved worktree
- [x] Confirm and document that `commit-wt` remains runnable from inside a worktree
- [x] `bunx tsc --noEmit` clean and full `bun test` green
**Resolved:** 2026-10-04T13:26:32.347Z decided: relax — rebase removed from ROOT_ONLY_COMMANDS in a270701 (resolves wtPath from branch arg like finalize/agent-merge exemptions)
