<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: destructive + gpg-bypass git guard (cc-safety-net seeded)

**Status:** Done
**Priority:** high
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, safety

**Summary:**

Block: reset --hard/--merge, clean, checkout path-restore shapes (--) / -f / pathspec-from-file, restore (non-staged), switch --discard-changes/-f, push -f, branch -D, tag -d, stash drop/clear, rebase --abort, merge --abort, rm -f, worktree remove --force, reflog expire/delete, update-ref -d, gc/maintenance, filter-branch, -c commit.gpgsign=false, --no-gpg-sign, --no-sign, credential.*/core.hooksPath/core.sshCommand overrides, --config-env on gpg keys. commit requires message flag (no editor).

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-04T02:00:46.687Z Landed: destructive+gpg-bypass blocks in policy.ts/predicates.ts (cc-safety-net seeded shapes), policy.test.ts 'destructive and gpg blocks'
