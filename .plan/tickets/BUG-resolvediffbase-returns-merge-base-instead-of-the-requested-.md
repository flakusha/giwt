<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: resolveDiffBase returns merge-base instead of the requested target, silently mis-scoping diff-base gates

**Status:** Not Started
**Priority:** medium
**Effort:** Small
**Tags:** finalize, gates, diff-base, checks

**Summary:**

src/commands/finalize/checks.ts:12-22 runs gitSyncQuiet(wtPath, 'merge-base', target, 'HEAD') and returns that merge-base SHA rather than the operator's requested target. Caller src/commands/finalize/gates.ts:36 passes it to `bun run check --diff-base <merge-base> <target>`. Because a merge-base is a valid ref the flag does not error - it silently scopes the check to a different file set than requested. Also affects src/commands/finalize/run.ts:90-92 (plan-validate gate scopes to the same merge-base); a fix must change both consumers.

**Context:**

## Impact

On a downstream consumer the merge-base form's file set differs from the
`git diff <target> HEAD` set in BOTH directions:

- **over-reports** files whose content the target has since independently reproduced
- **under-reports** files the target moved

An earlier measurement of "added 25, dropped 0" was one-directional and is
superseded by this two-directional result.

Because the merge-base is a valid ref, `--diff-base` never errors — the mis-scope
is silent, and a green finalize can mean "the wrong files were checked".

## Also affected

`src/commands/finalize/run.ts:90-92` — the plan-validate gate scopes per-file
gates (format / linkage / status-vocab) to the same merge-base. A fix must
change BOTH consumers.

## Tests pinning current behaviour (must be updated with any fix)

- `src/resolve-diff-base.test.ts:64-71`, `:73-79`, `:81-96`
- `src/plan/reconcile-conflicts.test.ts:1917-1920`
- `src/commands/finalize.test.ts:907` and `:980` (both compute
  `git merge-base main HEAD` as the expectation)

## Cross-reference

Downstream tracker ticket
`BUG-diff-scoped-gates-diff-against-a-stale-merge-base-so-scope-e` in loop-lore.
**Keep that one open** — it is the downstream symptom and the pin-bump
acceptance criterion.

**Severity:** Medium.

**Acceptance Criteria:**

- [ ] `resolveDiffBase` returns the operator's requested `target`, not `git merge-base target HEAD`
- [ ] Both consumers changed together: `src/commands/finalize/gates.ts:36` and `src/commands/finalize/run.ts:90-92`
- [ ] Tests listed above updated to assert the requested target, not `git merge-base main HEAD`
- [ ] A test pins the two-directional divergence (over-report AND under-report) so the bug cannot silently return
- [ ] `bun test src/resolve-diff-base.test.ts src/commands/finalize.test.ts src/plan/reconcile-conflicts.test.ts` green
- [ ] `bunx tsc --noEmit` clean
