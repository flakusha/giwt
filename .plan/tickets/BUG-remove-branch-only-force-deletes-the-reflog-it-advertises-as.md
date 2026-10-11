<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: remove --branch-only --force deletes the reflog it advertises as the recovery path

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** remove, worktree

**Summary:**

`giwt remove <name> --branch-only --force` prints `deleted branch X (tip <sha> recoverable from reflog)`, but git removes `.git/logs/refs/heads/<branch>` along with the ref, so the commit is NOT recoverable via `git reflog <branch>`. The message advertises a recovery path that does not exist. Same claim on the finalize teardown path.

**Context:**

`src/commands/remove.ts:227-229` (end of `removeBranchOnly`):

```ts
gitRun(config.repoRoot, "branch", "-D", branch);
}
log("success", `deleted branch ${branch} (tip ${sha} recoverable from reflog)`);
```

Same claim on the finalize path — `src/commands/finalize/teardown.ts:79-83`:

```ts
`Force-deleting ${branch} — unmerged commits discarded; tip ${tip} recoverable from reflog`
```

then the forced-delete call.

The forced delete removes the ref file AND its reflog. After that the branch name resolves to nothing, so `git reflog show <branch>` fails with `fatal: unknown revision` and the branch is gone from `.git/logs/refs/heads/`. The commit object itself survives (`git cat-file -t <sha>` returns `commit`) but is reachable only via `git fsck --lost-found` plus a manual SHA lookup.

**Reproduction:**

1. `git branch gone && SHA=$(git rev-parse gone)` — `git reflog show gone` lists `gone@{0}: branch: Created from master`
2. `giwt remove gone --branch-only --force` — prints `deleted branch gone (tip <sha> recoverable from reflog)`
3. `git reflog show gone` → `fatal: unknown revision`
4. `ls .git/logs/refs/heads/` no longer lists `gone`
5. `git cat-file -t $SHA` → `commit` (object survives), but only reachable via `git fsck --lost-found` + manual SHA lookup

Reproduced on a scratch repo at filing time: reflog present before the delete, absent after, object still present.

**Consequence:**

- The printed tip SHA reads like a safety net and is not one. An operator who follows the message hits `fatal: unknown revision`.
- `FIX-giwt-remove-cannot-delete-a-branch-whose-worktree-is-gone` and `BUG-finalize-teardown-branch-deletion-fallback-is-silent` both state as intended behaviour that the tip SHA is reported so the commit stays recoverable from the reflog. That intent does not hold on the forced path.
- The misleading string is locked in by tests: `src/commands/remove.test.ts:192-193` and `:258-260`, plus `src/commands/finalize.test.ts:1624` all assert it.

**Suggested fix direction:**

Losing the reflog is a git-level consequence of the ref deletion, so the minimum honest fix is to stop claiming reflog recoverability. Three options, in increasing order of work:

1. Make the message honest — drop the `recoverable from reflog` clause and print the exact recovery command: `git fsck --lost-found` then `git branch <name> <sha>`.
2. Preserve `.git/logs/refs/heads/<branch>` before deleting the ref (e.g. copy into the run-record area), so the advertised reflog recovery actually works.
3. Emit both: preserve the log AND print the fsck/branch recovery command.

Any of the three removes the false promise. Option 1 is the smallest honest change.

**Acceptance Criteria:**

- [ ] No message emitted by `remove --branch-only` or finalize teardown claims reflog recoverability on a path where the branch reflog was deleted
- [ ] The forced path prints the exact recovery command(s) for the tip SHA
- [ ] The stale assertions in `remove.test.ts` and `finalize.test.ts` are updated to match
- [ ] Regression test: after `giwt remove --branch-only --force`, the printed remedy actually resolves (`git fsck --lost-found` surfaces the SHA, and `git branch <name> <sha>` restores it)
