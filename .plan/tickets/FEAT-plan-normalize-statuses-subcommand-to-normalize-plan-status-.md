<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: plan normalize-statuses subcommand to normalize plan status values onto the closed vocabularies

**Status:** Not Started
**Priority:** critical
**Effort:** Medium
**Tags:** plan, migration

**Summary:**

`.plan/` has two status vocabularies that were never reconciled: the PLAN enum
(`STATUS_ENUM`, validated on ticket/epic `.md` headers) and the MATRIX columns
(`done | in_progress | open | draft | cancelled | other`) stored per-entry in
`.plan/tickets/index.json`. `giwt plan matrix` buckets an index entry by
`normalizeStatus`, which returns its input verbatim for anything outside its
regex classes — so `Not Started`, `Proposed` and `undefined` all freeze into the
index and land under `other`. Add `giwt plan normalize-statuses [--check]` to
rewrite epic/epic-header status lines onto the canonical enum (via the existing
`[status.aliases]` setting) and to collapse the pass-through index leftovers
into the matrix column their plan-vocabulary meaning implies. Values resolving
to neither vocabulary are reported, never guessed. Idempotent; `--check` exits 1
when drift remains.

**Context:**

Consumer impact: loop-lore's `scripts-migration-delete` branch repoints
`plan:status:normalize` and `plan:status:normalize:check` at
`giwt plan normalize-statuses` and deletes its own 286-line implementation plus
a 48-line test with no replacement. The subcommand does not exist — the plan
dispatcher table (`src/commands/plan.ts:36-68`) offers `code-map`, `gen-docs`,
`matrix`, `check-links`, `validate`, `metadata`, `report`, `status` and nothing
else, so `giwt plan normalize-statuses` exits 1 with "unknown plan
subcommand". loop-lore loses status-line normalization entirely: off-enum values
in epic headers stop being repaired, and `.plan/feature-matrix.md` keeps
bucketing every `Not Started` under `other` instead of `open`.

Two supporting exports are needed so the command has no private reach-ins:
`resolveStatus` (`src/plan/status-vocab.ts`) and `normalizeStatus`
(`src/tickets/sync-normalize.ts`) are absent from `src/index.ts` today, which is
why loop-lore's copy reached into `node_modules/giwt/src/...` by path.

**Acceptance Criteria:**

- [ ] `giwt plan normalize-statuses [--check]` exists as a plan subcommand and
      is registered in `SUBCOMMAND_INFO` / `src/cli-usage.ts`
- [ ] Off-enum epic/epic-header status values rewrite to the canonical enum via
      `[status.aliases]`; values in neither vocabulary are reported, not guessed
- [ ] Index statuses that `normalizeStatus` already classifies natively are a
      fixed point and left alone; only its pass-through leftovers are rewritten
- [ ] Second run rewrites nothing (idempotent); `--check` writes nothing and
      exits 1 when drift remains
- [ ] `resolveStatus` and `normalizeStatus` are exported from `src/index.ts`
- [ ] Tests passing
- [ ] Documentation updated
