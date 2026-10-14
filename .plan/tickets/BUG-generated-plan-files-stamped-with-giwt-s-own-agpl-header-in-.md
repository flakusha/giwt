<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: generated .plan/ files stamped with giwt's own AGPL header in consuming repos

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

`giwt` stamps a hardcoded two-line SPDX header into every `.plan/` file it
generates: the AGPL-3.0-or-later license identifier plus a copyright line
naming giwt Contributors (the two `<!-- ... -->` comment lines at the top of
`.plan/feature-matrix.md`).

That asserts giwt's own license over files in a CONSUMING repository that may
be under a completely different license. The generator does not know the
consumer's license; asserting one is the defect.

**Emission points (verified):**

- `giwt plan matrix` — `src/plan/feature-matrix.ts:167-168`, the first two
  entries of the `lines` array in `generateMatrixMarkdown()`. Reached from
  `src/plan/matrix.ts`, `src/commands/sync.ts:115`, `src/commands/scoped-reconcile.ts:47`,
  and `src/plan/reconcile-conflicts/generated.ts:48`.

- `giwt ticket` — the same two literals when the ticket .md is created.

## Lead for the fixer: the helper already exists

This is not a from-scratch design problem. Recorded so it does not have to be
rediscovered:

- Both emission sites above HARDCODE the two literals. Neither reads anything
  from the consuming repo.

- `parseLicenses()` in `src/utils/spdx-fix.ts:24-33` ALREADY resolves a
  consuming repo's `REUSE.toml` correctly — `buildHeader()` pulls both the
  license identifier and the copyright text from the matching `ReuseRule`.
  That is the correct existing seam, and `giwt spdx-fix` already uses it.

- So the likely SHAPE of the fix is routing the generators through that
  existing path rather than inventing a new mechanism. Treat this as a lead,
  not a decided solution — the judgement call is still open, and the
  no-header-at-all option remains on the table (see Suggested fix direction).

**Caveat that constrains any shape:** giwt's own repo is a self-hosting case.
It legitimately carries the AGPL header on its own `.plan/` files
(`.plan/feature-matrix.md` and `.plan/tickets/*.md` are consistent there), and
giwt's own `spdx:check` may assert it. giwt reads its own `REUSE.toml` the
same way any other consuming repo does, so a REUSE-routed header should be
self-consistent — but VERIFY that rather than assuming it. A fix that makes
giwt's own repo fail its own SPDX check is a wrong fix.

## Evidence from a real consuming repo (loop-lore)

- loop-lore's `REUSE.toml` declares `.plan/**` as
  `Apache-2.0 OR MIT OR CC-BY-4.0` with `2026 Loop Lore Contributors`.

- A repo-wide sweep corrected 1160 files to match.
- Every subsequent `giwt ticket` invocation re-injects the wrong header, so
  the sweep does not hold — it silently reverts on the next ticket.

- It has ALREADY re-broken on that repo's `dev`: commit `69b21c0bb`
  ("chore(plan): post-merge reconciliation") left `.plan/feature-matrix.md`
  carrying the AGPL identifier and the giwt Contributors copyright line.
  Verified on the current tree.

### Current blast radius: 59 files, not one

Measured on loop-lore `dev` at `1bcc37ab6` by running
`SPDX_CHECK=1 bun run spdx:check`, which reports
`59 file(s) with invalid SPDX headers` and exits 1:

- 58 files under `.plan/tickets/`
- 1 file, `.plan/feature-matrix.md`

All 59 carry the identical stamp — `AGPL-3.0-or-later` plus
`2026 giwt Contributors` — against loop-lore's expected
`Apache-2.0 OR MIT OR CC-BY-4.0` / `2026 Loop Lore Contributors`. There is
exactly ONE distinct failure reason across all 59; no file fails for any
other reason.

The 58 ticket violations all came from ONE session: commit `730524906`
("chore(plan): file 58 consolidated review findings as tickets"), followed by
`1bcc37ab6` (index sync). Every one of those 58 tickets inherited the wrong
header. A repo-wide census confirms the stamp appears on exactly those 59
files and no others.

**This is a per-ticket defect that scales with usage, not a one-file cosmetic
issue.** The originally recorded impact — one file, `.plan/feature-matrix.md`
— is materially understated. Each ticket anyone files in any consuming repo
adds one more violation. The count grew from 1 to 59 within a single day,
entirely from ordinary `giwt ticket` usage.

## Why it matters: the violation is SILENT

loop-lore's default `bun run spdx:check` is warn-only and exits 0. Only the
opt-in blocking mode (`SPDX_CHECK=1` set in the environment) fails. So the
header re-breaks on every ticket with NO gate failure — nothing announces the
regression, no check-report entry appears, and the commit looks clean.

That silence is precisely why this went unnoticed and why a repo-wide sweep
does not hold: the correction is undone by the next ordinary `giwt ticket`
invocation and no signal in the normal loop reports it. All 58 tickets from
commit `730524906` landed on `dev` through a fully green gate with 58 fresh
violations in the tree.

## Constraint any fix must respect

giwt's own repo legitimately carries the AGPL header on its own `.plan/`
files (`.plan/feature-matrix.md` and `.plan/tickets/*.md` are consistent
there), and giwt's own `spdx:check` may assert it. A fix must not break
giwt's self-hosting case — if the fix makes giwt's own repo fail its own SPDX
check, that is a wrong fix.

## Suggested fix direction

Not decided here — left to whoever picks it up. The two candidates:

1. Emit no license header at all into a consuming repo's generated files. The
   tool does not know the consumer's license, so asserting one is the actual
   defect. This is the smallest change that removes it.

2. Source the header from the consuming repo's own config, reusing the
   existing `REUSE.toml` seam in `src/utils/spdx-fix.ts` and falling back to
   (1) when absent.

A licensing header is metadata, not behaviour — a plugin architecture for it
would be over-engineering.

## Not a duplicate

This is emission into consuming repos only. giwt's own `.plan/` files carrying
the AGPL header is consistent and is not the defect.

**Context:**

Chose option (2): route headers through the consuming repo's REUSE.toml via `generatedHeader()`. The ticket's "existing seam" was broken — `parseReuseToml` read legacy keys (`paths`/`license`/`copyright`) instead of REUSE spec keys (`path`/`SPDX-License-Identifier`/`SPDX-FileCopyrightText`), returning 0 rules for any real REUSE.toml. Fixed the parser to accept both key sets. `generatedHeader(absPath, ext)` walks up to the nearest REUSE.toml and resolves the consumer's own header. gen-docs was also hardcoding Apache-2.0 + Loop Lore Contributors (a third-party license) — now sourced from the repo's REUSE.toml like every other generator. giwt's own REUSE.toml added so the spdx gate has rules to enforce. Option (2) over (1) because it preserves self-hosting correctness: giwt's own .plan/ files still carry the AGPL header via its own REUSE.toml.

Resolution: fix landed as `4dfba88` (on master; `433a777` closes this ticket). Verified end-to-end from consuming repo loop-lore, pinned to giwt `433a777`: a newly generated ticket and a regenerated `plan matrix` both carry `Apache-2.0` / `2026 Loop Lore Contributors` from loop-lore's own REUSE.toml — no giwt AGPL stamp — and its `SPDX_CHECK=1 spdx:check` went from 59 violations to 0.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing (1853 pass, 0 fail; 15-case smoke test covering spec keys, legacy keys, no-REUSE.toml, nested nearest-wins, no-copyright, no-match, multi-license OR)
- [x] Documentation updated (ticket closed)
