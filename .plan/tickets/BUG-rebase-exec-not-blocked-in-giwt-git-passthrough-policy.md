<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: rebase --exec not blocked in giwt git passthrough policy

**Status:** Not Started
**Priority:** medium
**Effort:** Small
**Tags:** security, policy

**Summary:**

`giwt git rebase --exec '<payload>'` passes classification and executes. `rebasePredicate` (src/git/predicates.ts:124-131) only refuses `--abort` and `-i/--interactive`; there is no `--exec`/`-x` handling. Probes show identity-override payloads passed via `--exec` are not caught. The omp harness guard catches this shape (identity-payload-in-`--exec` scanning), so it is a missing defence-in-depth layer in giwt rather than an open hole when the harness is active. Pre-existing since c60b7d6.

**Context:**

The giwt git passthrough policy is designed to block dangerous git operations. `rebasePredicate` currently blocks `--abort` and `-i/--interactive` but does not handle `--exec`/`-x`. This means identity-override payloads can be injected via `git rebase --exec` without being caught by giwt's own classification layer.

The omp harness guard does catch this shape, so this is a defence-in-depth gap rather than an open hole. However, giwt should have its own layer of protection.

**Acceptance Criteria:**

- [ ] `rebasePredicate` (or equivalent) blocks `--exec`/`-x` when the payload contains identity-override patterns (GIT_AUTHOR_*, GIT_COMMITTER_*, user.name=, user.email=, --author=)
- [ ] Benign `--exec` payloads (e.g. `make test`) still pass
- [ ] Tests cover both shapes
