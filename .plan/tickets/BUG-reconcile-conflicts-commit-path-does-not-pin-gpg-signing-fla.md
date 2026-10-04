<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: reconcile-conflicts commit path does not pin GPG signing flags - unsigned commit, no error

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** reconcile-conflicts, gpg, finalize

**Summary:**

src/plan/reconcile-conflicts/git-io.ts:19-30 (runGit) is the only commit-producing path in the codebase that does not pin '-c commit.gpgsign=true -c user.signingkey=...'. Compare src/commands/commit.ts:104-110, src/commands/commit-wt.ts:123-130, src/commands/finalize/merge.ts:9-22 (gpgMergeFlags()), src/commands/scoped-worktree.ts:231-235 (scopedSignFlags()). The reconciliation commit's signature therefore depends on ambient repo-local config that is not committed and is absent on a fresh clone or CI runner - producing an unsigned commit with no error and no warning. src/commands/finalize/merge.ts:72-74 documents having already fixed exactly this class for the merge path; the reconcile path is half-fixed: it has the assert but not the flags. Not live on the author's machine (commit.gpgsign=true is local-scope there) - consistency + portability defect. Fix is a 2-line mirror of scopedSignFlags().

**Context:**

## Reference implementations (all pin the flags explicitly)

- `src/commands/commit.ts:104-110`
- `src/commands/commit-wt.ts:123-130`
- `src/commands/finalize/merge.ts:9-22` — `gpgMergeFlags()`, additionally
  probes `gpg --list-secret-keys` first
- `src/commands/scoped-worktree.ts:231-235` — `scopedSignFlags()`, whose doc
  comment already says it "mirrors finalize's gpgMergeFlags so the
  reconciliation commit is signed exactly when an agent key is configured
  (cold-cache repos keep repo-local config)"

## Half-fixed class

`src/commands/finalize/merge.ts:72-74` documents having already fixed exactly
this class for the merge path ("the gate that previously let merge.ts silently
produce an unsigned merge when gpgMergeFlags() returned []"). The reconcile path
has the assert but not the flags.

## Severity

Low. Not live on the author's machine (`commit.gpgsign=true` is local-scope
there) — this is a consistency + portability defect: on a fresh clone or CI
runner the ambient config is absent and the commit is unsigned with no error
and no warning.

**Acceptance Criteria:**

- [x] The reconcile commit path pins `-c commit.gpgsign=true -c user.signingkey=<key>` the same way the four reference paths do
- [x] Fix mirrors `scopedSignFlags()` (`src/commands/scoped-worktree.ts:231-235`) — 2 lines, no new abstraction (flags threaded as `signFlags: string[]` from both callers; wrapped around the rebase invocation too, since `git rebase` re-signs the whole replayed tail)
- [x] Empty/absent agent key degrades to `[]`, matching `scopedSignFlags()`
- [x] Test asserts the flags reach the commit invocation (stub-gpg fixture: pinned key appears in gpg argv during replay + amend; no flags keeps gpg un-probed)

**Resolved:** 2026-10-04T00:13:00Z fixed in 6e0ff45: both callers pass scopedSignFlags(config.agentGpgKeyId) through rebaseWithPlanReconciliation; stub-gpg tests prove the pinned key reaches gpg
