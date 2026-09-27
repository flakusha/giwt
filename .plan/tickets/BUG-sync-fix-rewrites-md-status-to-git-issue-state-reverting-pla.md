<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: sync --fix rewrites .md status to git issue state, reverting plan status-vocab normalization

**Status:** ⬜ Not Started
**Priority:** high
**Effort:** Medium
**Tags:** status-vocab

## Summary

## Summary

`giwt sync --fix` and `giwt plan validate --fix` impose contradictory status authorities on the same `.md` file. Running them in either order silently undoes the other, so a repo cannot stay green on both gates.

## Problem

Two `--fix` implementations in the same tool write the same field with incompatible value spaces:

- **plan vocabulary (6 terms)** — `src/plan/status-vocab.ts` + `src/plan/validate.ts`, landed in `d40da74`, normalizes `.md` statuses to `Not Started | In Progress | Blocked | Done | Wontfix | Postponed`.
- **git issue state (2 terms)** — `src/tickets/sync-index.ts:726-727` pushes `ms.indexStatus` (mirrored from the git issue, i.e. `open`/`done`) back into the `.md`.

This is not incidental: `src/tickets/sync-issues-ops.test.ts:670-673` **asserts the erasure** —

```ts
expect(first.out).toContain("TASK-MULTI: .md status in_progress → open");
expect(text).not.toContain("blocked");
expect(text).not.toContain("In Progress");
```

So `sync --fix` is specified to delete vocabulary terms that `plan validate --fix` is specified to write.

## Reproduction (loop-lore, measured 2026-09-27)

1. `giwt plan validate --fix` → `2481 fix(es) applied`, status-vocab drops 2956 → 476.
2. `giwt sync` (report only) → `🟡 .md status stale (index authoritative): 1295`, every one of the form `BUG-…: .md="Not Started" → open`.
3. `giwt sync --fix` would therefore write `open` into 1295 `.md` files, re-breaking status-vocab back to ~2953.

The report header `🟡 .md status stale (index authoritative)` (`sync-index.ts:1010`) makes the conflict explicit: the index is authoritative for status, but the index is a mirror of git issue state (`open`/`done`), not of the plan vocabulary.

## Why this matters

A repo cannot be simultaneously `plan - validate` green and `sync` clean. Whoever runs the wrong `--fix` first silently corrupts the other gate, and the damage is invisible until the other tool runs. loop-lore hit this with 1295 files in one pass.

## Details

- `src/tickets/sync-index.ts:357-361` shows the design intent — oscillation between the two fixers was already noticed and papered over for the `📝 Draft` case, rather than resolved at the source.
- The deeper issue: git issues are binary (open/closed) but the plan vocabulary has 6 states, so `open` cannot distinguish `Not Started` from `In Progress`, and `Postponed` from `Wontfix`. Any sync that mirrors git state into the plan necessarily discards information.

## Acceptance

- [ ] One authority is chosen for `.md` status and documented.
- [ ] Running `sync --fix` then `plan validate --fix` (and the reverse) is idempotent — neither re-bricks the other.
- [ ] `src/tickets/sync-issues-ops.test.ts:670-673` is updated to assert the agreed behaviour rather than the erasure.
- [ ] Regression test: a ticket at `In Progress` with an open git issue survives a full `sync --fix` → `plan validate --fix` round-trip still at a vocabulary term.

## Related

- `BUG-parseticketfile-vs-omp-roster-divergence-on-dual-status-tick` (giwt, Done) — same class of problem, different axis: giwt vs omp-plugins agreement on *what counts as done*, rather than who owns the value.
- omp-plugins `BUG-find-work-closed-epic-reconciliation-stubs-leak-into-roster` (Done).

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
