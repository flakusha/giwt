<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: linked-worktree sync defers canonical index write but sync and plan validate treat stale index as actionable

**Status:** Done (fixed 2026-10-17: runSync reclassifies orphan files as deferred in a linked worktree — excluded from the actionable total, exit 0, `deferredRemaining` on the summary; --fix reports "0 persisted, N deferred" instead of the in-memory false green; `plan validate` tickets gate inherits exit 0. Tests: src/tickets/sync-worktree.test.ts repro chain worktree-ticket → --fix deferred → check 0 pre-merge → post-merge regeneration)
**Priority:** high
**Effort:** Medium
**Tags:** sync, worktree, index, false-green
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

## Summary

In a linked worktree, `giwt sync` (check mode) and the `plan validate` tickets gate classify orphan files (.md not in index) as actionable failures (exit 1, "ticket index out of sync") even though `persistIndexCanonical` (design 461e906) deliberately defers the index.json write until after merge on the target branch. Worse, `giwt sync --fix` computes its final verdict by re-running reconciliation on the IN-MEMORY fixed index, so it reports "ok sync N tickets, N fixed, 0 remaining" while nothing was persisted — the immediately following check run fails with the identical orphan set. Verdict and persisted state disagree.

## Context / Evidence (loop-lore worktree `provider-integrations`, 2026-10-17)

- 18 tickets exist only in the worktree (10 from a previous session, 8 new `giwt ticket` runs this session; issue refs created repo-shared).
- `giwt sync --fix` repeated runs print "ok sync 3812 tickets, 21 fixed, 0 remaining" (run records `20261017T081155-291565-sync`, `20261017T081318-314089-sync` under loop-lore `.tmp/giwt/runs/`).
- Next `giwt sync` (check): "Orphan files (.md not in index): 18", exit 1. `plan validate` tickets gate: FAIL "ticket index out of sync".
- Case-insensitive slug search across BOTH the worktree index.json and the main-checkout index.json finds ZERO occurrences of the new ticket slugs — the fixes never persist anywhere.
- The worktree index.json is the committed copy (tracked, unmodified); dev index mtime changes came only from concurrent dev-side runs.
- Consumption chain A-never-green: finalize runs its gates pre-merge IN the worktree, so any tickets-only branch cannot go green on `plan sync`/tickets gate before the very merge that would regenerate the canonical index.

## Root cause pointers

- `src/tickets/sync-index-write.ts:22-29` — linked-worktree write skip is intentional ("index write deferred — linked worktree; regenerated post-merge on the target branch").
- `src/tickets/sync-index.ts` `runSync` — after `persistIndexCanonical` the code "recomputes reconciliation on the *fixed* index" (in memory) for the summary, independent of whether the write happened.
- Check/report mode has no `deferred` state: orphan files are actionable exit-1 in every invocation in a linked worktree until a post-merge regeneration lands.
- NOT a detection bug: `src/utils/worktree-probe.ts` `isLinkedWorktree` (rev-parse --git-dir vs --git-common-dir) detects linked worktrees correctly.

## Expected behavior

1. In a linked worktree, classes that depend on the deferred write (orphan files / missing index entries) must be reported as deferred/excluded, not actionable — e.g. `pending (N deferred — canonical index regenerates post-merge)`, exit 0; validate tickets gate mirrors this.
2. `sync --fix` verdict must reflect PERSISTED state ("0 persisted, N deferred"), never an ok computed from memory.
3. Repro (minimal, any linked worktree): create a ticket via `giwt ticket`; `giwt sync --fix` → "ok, 0 remaining"; `giwt sync` (check) → same orphan(s), exit 1, forever until finalize.
4. Pin with tests alongside the existing `src/tickets/sync-worktree.test.ts` + `src/tickets/sync-index-write.ts` contract tests.

## Acceptance Criteria

- [x] linked-worktree check mode adds a deferred classification for index-write-dependent classes with exit 0
- [x] --fix summary switches to persisted-vs-deferred numbers; never claims resolved-until-persisted as ok
- [x] plan validate tickets gate no longer fails "index out of sync" in a linked worktree for deferred classes
- [x] contract tests cover: worktree ticket → sync --fix ok/deferred → check exit 0 pre-merge → post-merge regeneration reconciles

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
