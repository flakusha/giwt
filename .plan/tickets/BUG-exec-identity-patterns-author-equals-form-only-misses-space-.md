<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: EXEC_IDENTITY_PATTERNS --author equals-form only misses space-form and gpgsign bypass

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** security, policy

**Summary:**

`src/git/predicates.ts:125-131` EXEC_IDENTITY_PATTERNS covers `--author=` (equals form) but misses `--author 'Name <email>'` (space form). It also misses `commit.gpgsign=false` and `--no-gpg-sign` inside the payload, which bypass GPG signing. Proven with real git (2026-10-09).

**Context:**

EXEC_IDENTITY_PATTERNS currently:

```ts
const EXEC_IDENTITY_PATTERNS: readonly RegExp[] = [
  /GIT_AUTHOR_/i,
  /GIT_COMMITTER_/i,
  /user\.name=/i,
  /user\.email=/i,
  /--author=/i,
];
```

`--author=` requires the equals form. Git also accepts `--author 'Evil <evil@x>'` (space-separated). The probe confirms:

```text
git commit --amend --no-edit --author 'Evil <evil@x>'  ->  Evil <evil@x>
git -c commit.gpgsign=false commit --allow-empty -qm probe2  ->  accepted (exit 0)
```

**Evidence:**

Probe (2026-10-09):

```text
--- --author space form ---
Evil <evil@x>
--- -c commit.gpgsign=false accepted? ---
accepted (exit 0)
```

So `giwt git rebase --exec 'git commit --amend --no-edit --author "Evil <e@x>"'` passes the predicate (no `--author=` match), and `giwt git rebase --exec 'git -c commit.gpgsign=false commit --amend --no-edit'` produces an unsigned commit.

**Consequence:**

Defence-in-depth gap in giwt's own layer. The omp harness guard catches the space form (`commitAuthorOverride` matches `t === "--author"`), so this is not an open hole when the harness is active. But giwt's passthrough policy is supposed to be self-contained.

**Suggested fix direction:**

1. Change `/--author=/i` to `/--author[=\s]/i` (match both `=` and space forms).
2. Add `/commit\.gpgsign\s*=\s*false/i` and `/--no-gpg-sign/i` to EXEC_IDENTITY_PATTERNS.

**Acceptance Criteria:**

- [ ] `git rebase --exec 'git commit --amend --author "Evil <e@x>"'` blocked
- [ ] `git rebase --exec 'git -c commit.gpgsign=false commit --amend'` blocked
- [ ] `git rebase --exec 'make test'` still passes (benign payload)
- [ ] Tests cover space-form --author and gpg-bypass payloads

**Not a duplicate:**

`BUG-rebase-exec-not-blocked-in-giwt-git-passthrough-policy` covers the initial addition of EXEC_IDENTITY_PATTERNS. This ticket covers the remaining gaps in those patterns.

git issue: 04cb67a
