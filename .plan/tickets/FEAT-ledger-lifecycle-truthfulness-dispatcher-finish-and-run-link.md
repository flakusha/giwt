<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: ledger lifecycle truthfulness: dispatcher finish and run links

**Status:** Not Started
**Priority:** high
**Effort:** Medium
**Tags:** ledger, observability, agents

**Summary:**

Make the ledger lifecycle true: every non-silent run's ledger line reaches a terminal
state via a dispatcher-driven finish, and the two evidence records (run dir, ledger
line) are cross-linked. Currently the ledger — the repo's message bus — systematically
lies about liveness.

**Context:**

Evidence (proposals doc 2026-10-14, P1):

- Every non-silent run appends one ledger record with `state: "in-progress"`
  (src/utils/ledger.ts:165-167). The only production writers that ever move a line to a
  terminal state are `appendCommitOutcome` (ledger.ts:266-282) and `appendGripe`
  (ledger.ts:185-191); `finishRecord` has exactly two production wrapper callers.
  `state: "postponed"` and `LedgerError.gates` are written by no production code — only
  ledger.test.ts:784-805 exercises them. src/cli.ts:160-170 finishes the *run record*
  (`runRec?.finish(...)`) but never the *ledger line*.

- Consequence: a successful `finalize`, `doctor check`, `sync`, `clean`, `create`,
  `rebase`, `git …` leaves its line `in-progress` forever; a **failed** `commit` also
  stays `in-progress` (appendCommitOutcome runs only on success).

- The two evidence records are unlinked: the ledger record v2 has no run-dir pointer
  (src/utils/ledger-core.ts:56-69) and `RunMeta` has no ledger seq
  (src/utils/runlog-types.ts:43-57). `appendLedger` builds and then discards the record
  (`const record = withLedgerLock(...); void record;` — ledger.ts:143-172).

- Query surface: `giwt ledger [--last N] [--json]` only (src/commands/ledger.ts:14-50);
  `formatRecord` renders `[ts] [#pid] [branch] cmd: msg` and drops `state`/`error`
  entirely (ledger-core.ts:166-170). Cap is 50 records, whole-file rewrite per append
  (ledger-core.ts:25, ledger.ts:169).

Design (from the proposal, verified against the actual bodies):

1. Dispatcher finish: in `main()` (src/cli.ts:160-170), after `runRec?.finish(code)`,
   call a new `finishOwnLedger(treeDir, cmdName, code)` — a thin wrapper over the
   existing in-place `finishRecord` (ledger.ts:214-248):
   `code === 0 → { state: "finished", text: "ok" }`, else
   `{ state: "postponed", text: "exit <code>", error: { message, code } }`.
   pid+cmd matching scopes it to this invocation's line; silent commands appended
   nothing, so nothing to finish.

2. Cross-links: `appendLedger` returns the written record (delete `void record`,
   ledger.ts:172). Add `run?: string` (run-dir basename) to `LedgerRecordV2` and
   `ledgerSeq?: number` to `RunMeta`; enrich both in place via the existing
   rewrite-on-append machinery.
   REQUIRED: the new field must be threaded through `normalizeRecord` explicitly
   (ledger-core.ts:92-124) — the v2 branch RECONSTRUCTS the record field-by-field
   (lines 97-108), so an additive `run` key is silently dropped on every read, and
   `finishRecord` writes its enrichment back through that normalized view
   (ledger.ts:226→240), stripping the cross-link on the first commit/gripe enrichment.
   Add `...(rec.run === undefined ? {} : { run: rec.run })` to the v2 branch and mirror
   `ledgerSeq?` in `RunMeta` + `writeMeta` (runlog-types.ts:43-57, 94-98).

3. Renderer: `formatRecord` (ledger-core.ts:166-170) appends a space plus `<state>` when
   state ≠ finished and a space plus `!<error.message>` when error is present. `giwt ledger` gains
   `--state <s>`, `--cmd <name>`, `--branch <b>` filters (pure post-filters over
   `readLedger`, ~20 lines in commands/ledger.ts).

4. Cap: raise `LEDGER_MAX_RECORDS` 50 → 500 (ledger-core.ts:25). Append cost is a full
   rewrite (ledger.ts:169) — still trivial at 500 short lines; 50 scrolls out in
   minutes with several agents.

Tradeoffs: one extra read-modify-write pass of `.ledger.jsonl` per run (same
`withLedgerLock`); additive fields — older lines simply lack `run`, no flag day.

**Acceptance Criteria:**

- [ ] After any non-silent command completes, its ledger line has a terminal state (`finished` on exit 0, `postponed` + `error.{message,code}` otherwise) — no new `in-progress` lines survive a run
- [ ] A successful `giwt sync` and a failed `giwt commit` both demonstrate the terminal state in `.ledger.jsonl`
- [ ] New ledger records carry `run: <run-dir basename>` and the run's `meta.json` carries `ledgerSeq: <seq>`; `normalizeRecord` preserves `run` on read (test: write, re-read, assert key survives)
- [ ] `giwt ledger --state postponed`, `--cmd commit`, `--branch <b>` filter correctly (unit tests)
- [ ] `formatRecord` output shows a space plus `<state>` for non-finished lines and a space plus `!<msg>` for errored lines
- [ ] `LEDGER_MAX_RECORDS` is 500; a 600-record file truncates to 500 after an append
- [ ] `bunx tsc --noEmit` clean; `bun test src/utils/ledger.test.ts` green
