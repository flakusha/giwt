<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: rebase default target is the root branch, which is also protected, so the no-onto form always fails

**Status:** Not Started
**Priority:** high
**Effort:** Small
**Tags:** rebase, git, history-safety

**Summary:**

`giwt rebase <branch>` with no `onto` argument - the form in the usage string and
in loop-lore's AGENTS.md - can never succeed on a default config.

`src/commands/rebase.ts:14` sets `target = onto || config.settings.branches.root`,
and `src/commands/rebase.ts:27` refuses when that target is protected.
`DEFAULT_SETTINGS` (`src/utils/settings.ts:90`) ships
`branches: { protected: ["master","main","stg","dev"], root: "dev" }`, so the
default target is always protected and the guard always fires:

    $ giwt rebase feature
    error: cannot rebase onto protected branch 'dev'    (exit 1)

Verified against current `src/cli.ts` in a throwaway repo whose `giwt.toml`
sets `[branches] root = "dev"`.

**Context:**

This is a regression from the target-protection guard shipped for
BUG-rebase-guard-checks-only-the-source-branch-not-the-target-re (marked Done).
That ticket correctly blocked `giwt rebase FEATURE dev`, which rewrote protected
history 51x in loop-lore. But the guard cannot distinguish "rebase a feature
onto the integration branch" from "rewrite the integration branch" - the second
case is already covered by the source check at line 22, and the default target is
by construction never the source.

The check should exempt the configured `branches.root` from the target-side guard
(and/or exclude `root` from the protected set used for target checks), while
keeping the source-side guard and the explicit-`onto` case strict.

It is currently MASKED: `bin/giwt` was built 2026-09-28, before the guard landed,
and still succeeds on this input. The bug only surfaces on the next rebuild, so
nobody running the installed binary today sees it.

**Acceptance Criteria:**

- [ ] `giwt rebase <branch>` with no `onto` succeeds on a default config
      (`branches.root = "dev"` with `dev` in `branches.protected`)
- [ ] `giwt rebase FEATURE dev` is still refused, or the refusal is proven
      unreachable now that the root is exempt
- [ ] A regression test drives the no-`onto` form through the real CLI and fails
      against the current code
- [ ] The test does not depend on a stale `bin/giwt` build
- [ ] `bun test src/commands/` green
