<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: commit-wt hardcodes --no-verify, bypassing the consuming repo pre-commit hook

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** commit-wt, hooks, git

**Summary:**
`giwt commit-wt` spawns its commit with a hardcoded, non-configurable
`--no-verify` (`src/commands/commit-wt.ts:129`), so every commit made through
the command skips the consuming repository's `.githooks/pre-commit` entirely —
dprint formatting, eslint, SPDX headers, and check-report freshness — with no
flag to opt back in and no warning that hooks were skipped.

**Context:**

Reported from loop-lore, found and verified by execution. The spawn is
`src/commands/commit-wt.ts:118-143`:

```ts
const result = Bun.spawnSync(
  [
    "git",
    "-C",
    wtPath,
    "-c",
    `user.signingkey=${credentials.keyId}`,
    "-c",
    "commit.gpgsign=true",
    "commit",
    "-S",
    "--no-verify",                     // line 129 — hardcoded, no flag removes it
    `--author=${authorName} <${authorEmail}>`,   // line 130
    "-m",
    message,
  ],
  { /* stdout/stderr pipe, env: isolatedGitEnv() + GIT_COMMITTER_* */ },
);
```

`--no-verify` sits at line 129, between `-S` (128) and the `--author=` element
(130), as a literal array entry with no branch around it. The handler does parse
`args` — line 22 reads `--on-protected` and lines 23-25 extract the message
input — but no parsed flag reaches the spawn array, so no caller can add or
remove `--no-verify`.

## Observed consequence

In loop-lore, 8 pre-existing `padding-line-between-statements` eslint violations
sat on branches that `giwt commit-wt` had committed without complaint. They only
surfaced when a raw commit was attempted and the pre-commit hook blocked it; the
raw-commit attempt was refused and `giwt commit-wt` then landed the same work
silently. The gate was the only thing standing between the branch and the
violations, and the sanctioned commit path walked straight past it.

## Evidence

- `~/.local/bin/giwt` resolves to `/home/flak/git-ai/giwt/bin/giwt` — the
  MUTABLE local checkout, not a vendored copy under `node_modules`. `cmp`
  confirms `loop-lore/node_modules/giwt/src/commands/commit-wt.ts` and
  `giwt/src/commands/commit-wt.ts` are byte-identical, so the defect is present
  in the pinned ref too, not just in the local working copy.
- The check-report-freshness warnings observed during that session —
  `Check report stale: reports @ a862b06b3, current HEAD @ b5c7020ca` and
  `No check report found` — could only have originated from raw-commit
  attempts, because `commit-wt` never reaches that hook step at all. Their
  appearance is proof that the hook was reached by one path and skipped by
  another in the same session.
- loop-lore's own pre-commit hook failure text (`To commit without checks: ...`,
  naming the `--no-verify` escape) actively advertises the bypass giwt performs
  unconditionally and silently. The hook offers that escape hatch as a
  deliberate human decision; giwt takes it invisibly on every commit.

## Consequence

`giwt commit-wt` is a systematic hole in the gate loop for every consuming repo:

- non-configurable — no flag, no config key, no env var
- silent — nothing in the output says hooks were skipped
- unavoidable — an agent following the harness git-rerouting rule has no other
  path to a signed commit in a worktree

This is the same class of problem giwt already guards on the raw-git side
(`src/git/predicates.ts` refuses destructive and gpg-bypass shapes): giwt
refuses `--no-gpg-sign` from a caller, then performs an equivalent bypass
internally, in the one command agents are told to use instead.

## Suggested fix direction

Make the bypass opt-in rather than unconditional:

1. Accept a `--no-verify` flag from the caller, so a harness or agent that has
   already run the gate says so explicitly on the command line — the same
   contract loop-lore's hook offers to a human.
2. Otherwise let the hook run: drop the literal and let git honour
   `core.hooksPath` as the consuming repo configured it.
3. Keep a flag for the legitimate "hooks are too slow / repo has none" case
   rather than applying it by default.
4. Update the `commit-wt` entry in `src/cli-usage.ts` USAGE when the flags land.

One thing to verify before turning the hook back on, rather than an assumed
break: `isolatedGitEnv()` (`src/utils/git.ts:144-167`) strips every `GIT_`
-prefixed variable, plus the `OMP_`/`PI_`/`ENGRAM_`/`MNEMO_` harness
prefixes, from the environment handed to the `commit` process. That does NOT
starve the hook of context: git generates its own hook-scoped environment when
it invokes `pre-commit`. This repo relies on exactly that — its
`.githooks/pre-commit:44-53` strips those same variables again before running
the toolchain, with the comment that they are hook-scoped and must not leak into
the fixture repos the gate spawns. What is worth confirming is that a hook
reached through giwt sees the same toolchain environment a raw commit gives it,
and that the hook's own stripping still holds when the parent process is giwt
rather than a shell.

## Reproduction

Read `src/commands/commit-wt.ts:118-143` — `--no-verify` is a literal array
entry with no branch around it. Dynamically: in any repo whose
`core.hooksPath` setting points at a hooks directory holding a `pre-commit`
script, run `giwt commit-wt <branch> -m "msg"` against a tree that hook would
reject. No hook output appears and the commit lands.

## Not a duplicate

`TASK-pre-commit-hook-s-2s-rationale-for-the-unconditional-full-ga` is about the
cost and rationale of the full gate in this repo's own hook. This ticket is
about giwt skipping the hook entirely, in any consuming repo.

**Acceptance Criteria:**

- [x] `--no-verify` is opt-in via a caller-supplied flag, not a literal in the spawn array
- [x] Default `commit-wt` runs the consuming repo's `pre-commit` hook
- [x] `src/cli-usage.ts` USAGE for `commit-wt` documents the new flag(s)
- [x] A test asserts the flag is absent from the default spawn argv and present when passed
- [x] The `isolatedGitEnv()` interaction with an invoked hook is verified or documented
- [x] `bunx tsc --noEmit` clean and full `bun test` green
**Resolved:** 2026-10-04T13:26:32.427Z fixed in a270701: --no-verify opt-in in commit-wt and commit (same defect found in commit.ts), default runs hooks, tests added
