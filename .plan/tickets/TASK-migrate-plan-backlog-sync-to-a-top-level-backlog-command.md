<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: migrate plan backlog-sync to a top-level backlog command

**Status:** Done
**Priority:** Medium
**Effort:** Medium

**Summary:**

Promote `giwt plan backlog-sync` to a top-level `giwt backlog` command with a
`sync` subcommand (cutover — no alias kept):

- new `src/commands/backlog.ts` owning the handler moved out of `plan.ts`
- registry + `USAGE` entries for `backlog`; `plan backlog-sync` removed
- `plan validate` fix hint updated to `giwt backlog sync --fix`
- help text, tests, and docs updated to the new surface

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] `giwt backlog sync [--fix] [--verbose]` implemented in `src/commands/backlog.ts` (missing-dir guard preserved)
- [x] `plan backlog-sync` removed: SUBCOMMAND_INFO entry, switch case, handler, USAGE line, command description
- [x] Registry + `USAGE["backlog"]` added; `plan validate` fix hint now `giwt backlog sync --fix`
- [x] Dogfood: in-sync run on loop-lore (exit 0), missing-dir friendly error in giwt repo, unknown-subcommand usage exit 1
**Resolved:** 2026-10-02T01:00:35.135Z verified: backlog.ts + registry live, plan backlog-sync removed, tests green
