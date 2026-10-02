<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize leaks worktree and branch when the target already contains the branch

**Status:** Done (fix `fa4b190`, 2026-10-02: `alreadyMerged` fall-through — warn replaces `process.exit(0)`, `closeScopedIssues`/Step 5/Step 5.5 gated on `!alreadyMerged`, Steps 6/7 unconditional, final line reports "already contained in `<target>`". Repro before: EXIT=0, branch LEAKED, worktree LEAKED, admin=1; after: teardown complete, admin=0. Dirty worktree still refused at Step 1. The leak-pinning test rewritten to assert teardown; added dirty-already-merged refusal + scoped close/reconcile coverage. Full suite 1283 pass / 0 fail, tsc clean.)
**Priority:** high
**Effort:** Medium

**Summary:**

`giwt finalize` Step 4 computes `git rev-list --count <target>..HEAD` and, when
that is 0, logs `has no commits beyond <target> - nothing to merge` and calls
`process.exit(0)`. That return happens BEFORE Step 6 (`git worktree remove
--force`) and Step 7 (`git branch -d`), so finalize reports success while the
worktree directory, its `.git/worktrees/<name>` admin entry, and the branch ref
all survive.

**Context:**

`src/commands/finalize.ts:1432-1439` (guard) versus `:1611-1642` (teardown):

```ts
const aheadStr = gitSync(wtPath, "rev-list", "--count", `${targetBranch}..HEAD`);
const ahead = parseInt(aheadStr || "0", 10);
if (ahead === 0) {
  log("warn", `Branch '${branch}' has no commits beyond ${targetBranch} — nothing to merge`);
  process.exit(0);          // returns 170 lines before teardown
}
```

Verified reproduction against the real CLI (`bun run src/cli.ts finalize`,
scratch repo, branch fast-forward-merged into the target by hand, worktree
clean, ahead==0):

```text
Step 4: Checking commits...
warn: Branch 'already-merged' has no commits beyond main — nothing to merge
EXIT=0
--- result ---
branch: LEAKED
worktree: LEAKED
stale admin dir under .git/worktrees: 1
```

Control case with ahead>0 reaches Step 6/7 and cleans up fully, so this is
specific to the ahead==0 path.

Origin: `fc2abc4` (2026-09-13, the initial standalone-CLI commit) — a latent
bug since the first release, not a regression.

The user-facing contract is already wrong: `src/cli.ts:220` describes the
command as "Validate, merge, remove worktree, delete branch", i.e. teardown is
promised unconditionally.

## Why the suite stayed green

`src/commands/finalize.test.ts:1131-1138` ("stops when the branch has no
commits beyond the target") asserts only `exitCode === 0` plus the warn
substring. It never asserts that the worktree is gone, so it pins the leak
rather than catching it. A teardown command's test must assert the teardown.

### Fix direction

Fall through instead of exiting. Replace the early return with a flag, and
gate the merge-side effects on it so nothing merges or reconciles when there is
nothing to merge:

- `const alreadyMerged = ahead === 0` — log the warning, no `process.exit`
- Step 5 rebase/squash: `!alreadyMerged && (mergeStrategy === "rebase" || ...)`
- Step 5 direct: `!alreadyMerged && mergeStrategy === "direct"`
- `closeScopedIssues(...)`: guard on `!alreadyMerged`
- Step 5.5 plan reconciliation: guard on `!alreadyMerged`
- Steps 6 and 7 run unconditionally

This makes finalize idempotent and gives agents a recovery path for a worktree
whose branch already landed (an interrupted earlier finalize, or a manual
`git merge`).

Verified on a patched copy: ahead==0 now reaches Step 6/7 and removes worktree,
branch, and admin entry; ahead>0 still rebases and ff-merges then tears down;
a dirty worktree is still refused at Step 1 (the guard is not weakened). Full
suite 1281 pass / 0 fail, identical to the unpatched baseline.

### Related: loop-lore's fork

The same guard exists verbatim in loop-lore's in-repo fork at
`scripts/worktree/commands/finalize.ts:927-930` (teardown at `:1063-1076`),
reproduced live through its real dispatcher. loop-lore is retiring that fork,
so the canonical fix in giwt is what closes both.

**Acceptance Criteria:**

- [x] `finalize` on a branch the target already contains still runs the Step 6
      worktree remove and Step 7 branch delete: worktree dir, `.git/worktrees`
      admin entry, and branch ref are all gone, and the command exits 0
- [x] Nothing merges or reconciles when `ahead == 0`: Step 5 (rebase/squash and
      direct), `closeScopedIssues`, and Step 5.5 plan reconciliation are all
      skipped
- [x] A dirty worktree is still refused at Step 1 with the worktree intact
- [x] `finalize.test.ts` "stops when the branch has no commits beyond the
      target" is rewritten to assert the teardown (`Worktree removed`,
      `Branch deleted`, `!existsSync(wtPath)`, branch ref unresolvable) instead
      of only the exit code and warn substring
- [x] A normal `ahead > 0` finalize still rebases, fast-forwards, and tears down
- [x] `bunx tsc --noEmit` clean and full `bun test` green
