<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: rebase --exec identity guard bypassed by -ix short-flag cluster and regex gaps

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** security, policy

**Summary:**

The `rebase --exec` identity guard (`src/git/predicates.ts` `rebasePredicate`, landed in `1f507d9`) is bypassable. Two independent reviews reproduced this end-to-end on 2026-10-09.

**Context:**

`rebasePredicate` derives the exec payload only for `--exec`, `--exec=`, `-x`, `-x=`, `-x<payload>`, and checks the interactive flag with `args.includes("-i")`. Neither handles a combined short-flag cluster. The `giwt git` passthrough (`src/commands/git.ts` -> `classifyGitInvocation` -> `PREDICATES.rebase`) is the sole guarded path.

**Evidence (verified E2E, fresh repo, identity pinned):**

1. Cluster bypass — `-ix`:
   - `giwt git rebase -x 'git -c user.name=Evil commit --amend --no-edit' main` -> BLOCKED (exit 1), correct.
   - `giwt git rebase -ix 'git -c user.name=Evil commit --amend --no-edit' main` -> exit 0, guard skipped, committer rewritten to `Evil`. BYPASS.
   - `giwt git rebase -ix'<payload>' main` (attached) -> exit 0, same bypass.
   - Root cause: `args.includes("-i")` is false for `-ix`; the `-x` extraction requires `startsWith("-x")`, false for `-ix`. Payload never derived -> identity scan skipped entirely.
2. Regex gaps at the plain `-x` shape (payload reaches git unblocked):
   - `-x 'git -c commit.gpgsign=0 commit --amend --no-edit'` -> pass (pattern requires literal `false`).
   - `-x 'git commit --amend --no-edit --reset-author'` -> pass (`--author[=\s]` does not match `--reset-author`).
   - `-x 'git config user.name Evil'` -> pass (`user\.name=` requires `=`).
   - Also unhandled: `-c user.name Evil` (space), `-c 'user.name=Evil'` (quoted pair), `commit.gpgsign=no|off`, `--author` at end-of-payload.

**Consequence:**

An agent that spells the rebase exec as `-ix` (or attaches the payload) runs an arbitrary identity-override / gpg-bypass command inside the rebase, defeating the guard that `1f507d9` added. The existing test `policy.test.ts:252` only exercises separate `-i -x` tokens (which block via the `-i` rule), so the suite is green while the bypass ships.

**Suggested fix direction:**

1. Normalize combined short clusters the way git does: for a token matching `/^-[a-zA-Z]/`, scan each char; if `x` is present, the remainder after `x` is the attached payload else the next token is the payload (reuse the cluster-scan style in `src/git/predicate-helpers.ts`). Apply the identity check to that payload. Also treat a cluster containing `i` as interactive.
2. Widen `EXEC_IDENTITY_PATTERNS`: `user\.name\s*=`, `user\.email\s*=`, quoted `-c 'user.name=…'`, `\bgit\s+config\s+user\.(name|email)\b`, `commit\.gpgsign\s*=\s*(false|0|no|off)`, `--reset-author`, and `--author` as end-of-payload.

**Acceptance Criteria:**

- [ ] `giwt git rebase -ix '<identity payload>' main` and `-ix'<payload>'` are BLOCKED
- [ ] `-x 'git -c commit.gpgsign=0|no|off …'`, `-x '… --reset-author'`, `-x 'git config user.name …'`, `-x "git -c user.name Evil …"`, `-x "git -c 'user.name=Evil' …"` are BLOCKED
- [ ] benign payloads (`make test`, `echo hi`, `git log --pretty=%an`) still pass
- [ ] Tests cover the cluster form and each regex gap

**Not a duplicate:**

`BUG-exec-identity-patterns-author-equals-form-only-misses-space-` (fixed by `1f507d9`) covered the `--author` space form and gpgsign patterns. This ticket covers the short-flag CLUSTER bypass and the remaining regex gaps, which `1f507d9` did not address.
