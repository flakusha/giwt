<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FIX: referenced artifacts must outlive the console

**Status:** Not Started
**Priority:** high
**Effort:** Small
**Tags:** runlog, finalize, observability

**Summary:**

Four small fixes so every file/path the console points at survives the run: render
`RunOutcome.scratch`, put outcome+dir on the runs emoji line, copy check-report.json
into the run dir at gate time, and wire `LedgerError.gates` from `LAST_FAILED_GATES`.

**Context:**

Evidence (proposals doc 2026-10-14, P5):

- **`formatOutcome` drops `scratch`.** `RunOutcome.scratch` exists
  (src/utils/runlog-types.ts:39-40, written by finalize/scratch-prune.ts:148) but the
  renderer covers only failedGates/mergeCommit/sync/doctor/clean/tmp
  (src/utils/runlog-read.ts:72-90) — the human `giwt runs` line and the emoji path
  silently lose the Step-6a summary.

- **`runs --emoji` drops outcome and the dir pointer** — src/commands/runs.ts:242-247
  renders only `✅|❌ cmd <dur>`; an emoji-format consumer cannot find the run record
  at all.

- **check-report.json dies with the worktree.** The gate reporter reads the runner's
  `.tmp/check-report.json` in the worktree (finalize/checks.ts:106-110) and prints its
  path (checks.ts:164-165), but on *success* teardown removes the worktree
  (finalize/teardown.ts:73-77) — the referenced file is gone while `check.log`
  (captured) survives. Only the failing path leaves a usable report, and even then
  only until scratch pruning caps it (scratch.ts:233-261, keep 20).

- **Ledger error.gates unwired**: finalize's failing-gate outcomes go to the run
  record only (finalize/gates.ts:43-45, finalize/run.ts:108-110, staging-sync.ts:145);
  the ledger's designed channel for exactly this (`LedgerError.gates`,
  src/utils/ledger-core.ts:37-41) has no production writer (only
  ledger.test.ts:784-805).

- Already good (leave alone): run dir captures (check.log, test.log, git-output.txt),
  `skips.jsonl` self-sufficiency (history/skips.ts:29-43), ledger msg carrying
  `:: outcome` text (ledger.ts:236-241).

Design:

1. Add `if (outcome.scratch) parts.push(...)` to `formatOutcome` (runlog-read.ts:89)
   and include `outcome` + `dir` in the runs emoji mapper (runs.ts:242-247).

2. Copy-on-gate: when the check gate finishes, copy the worktree's check-report.json
   into the run dir (`rec.capturePath("check-report.json")` — finalize/checks.ts, next
   to where check.log is captured). ~10 lines; makes the console pointer immortal and
   gives `giwt runs triage` a second input.

3. Wire the gate list into the ledger: in the P1 dispatcher hook, when
   `LAST_FAILED_GATES` is non-empty (finalize/checks.ts module state, already exported
   — gates.ts:18 imports it) attach
   `error: { message, code, gates: [...LAST_FAILED_GATES] }` so the ledger line alone
   answers "which gates failed".

Tradeoffs: one small file copy per finalize run (a few KB); `LAST_FAILED_GATES` is
finalize-scoped module state — the field stays optional for generic commands.

**Acceptance Criteria:**

- [ ] `formatOutcome` renders a scratch summary when `outcome.scratch` is set (unit test with a fixture outcome)
- [ ] `giwt runs --emoji` lines include the dir and outcome summary, not just `✅|❌ cmd <dur>`
- [ ] After a finalize run (success or failure), `<run-dir>/check-report.json` exists and the printed path resolves to it
- [ ] A finalize run with failed gates produces a ledger line whose `error.gates` names the failing gates; a run with no failed gates has no `gates` key
- [ ] `bunx tsc --noEmit` clean; `bun test` green
