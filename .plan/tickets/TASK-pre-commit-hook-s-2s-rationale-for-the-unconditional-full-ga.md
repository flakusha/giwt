<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: pre-commit hook's '~2s' rationale for the unconditional full gate is stale by ~19x

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** hooks, githooks, pre-commit

**Summary:**

.githooks/pre-commit:4-7 justifies running the full gate suite with 'the suite runs in ~2s, so there is no staged-files-only fast path'. Measured 'bun test' alone is 38.10s (3 runs, 1357 tests / 74 files) - before fmt, lint, markdownlint, shfmt, shellcheck, knip, jscpd and tsc. The stated basis for the design no longer holds. The gate is invoked unconditionally at .githooks/pre-commit:43-57. Cheapest resolution: correct the comment. The design change (a staged-files fast path) is optional and should be preceded by timing the whole 'bun run check'. Stale rationale, not a correctness bug.

**Context:**

## The stale comment

`.githooks/pre-commit:4-7`:

> tsc is project-wide by design (no per-file tsconfig mode) and the
> suite runs in ~2s, so there is no staged-files-only fast path — the
> full gate IS the fast path. Staged-file detection only decides
> whether the gate needs to run at all.

## Measurement

| | claimed | measured |
| --- | --- | --- |
| `bun test` alone | ~2s | **38.10s** (3 runs, 1357 tests / 74 files) |

That is before fmt, lint, markdownlint, shfmt, shellcheck, knip, jscpd and tsc.
The suite is stale by **~19x**. The stated basis for the design no longer holds.

The gate is invoked unconditionally at `.githooks/pre-commit:43-57`; staged-file
detection (`:29-36`) only decides whether it runs at all.

**Severity:** Medium — a stale rationale, not a correctness bug. The design
change is optional; **correcting the comment is the cheapest resolution.**
Any staged-files fast path should be preceded by timing the whole
`bun run check`.

**Acceptance Criteria:**

- [x] The `~2s` claim at `.githooks/pre-commit:4-7` is corrected to a measured figure (or the claim is removed and replaced with a pointer to where timings are recorded)
- [x] If the rationale is rewritten to justify the design on other grounds, it cites those grounds rather than a runtime
- [x] Comment change passes `shfmt -ln posix -i 2 -d .githooks` and `shellcheck`
**Resolved:** 2026-10-04T02:02:47.751Z Landed: comment corrected with measured ~38s/1357-test figures; design change (staged-files fast path) left optional per ticket
