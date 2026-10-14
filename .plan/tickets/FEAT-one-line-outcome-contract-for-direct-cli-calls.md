<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: one-line outcome contract for direct CLI calls

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** cli, output, agents

**Summary:**

Give every mutating `giwt <cmd>` invocation one stable, regex-able final outcome line,
and demote static boilerplate/context dumps off the stdout data channel. Document the
contract in AGENTS.md: stdout = payload + exactly one outcome line; everything else is
log()-gated chatter or stderr.

**Context:**

Evidence (proposals doc 2026-10-14, P3, token audit of typical stdout):

- finalize preamble: src/commands/finalize/run.ts:38-40 emits `section(...)` +
  `printRecentLedger(treeDir, 10)` — ~12 lines / ~700 B (~200 tok) **before any step
  runs**.

- commit/commit-wt: src/commands/commit-wt.ts:150-153 prints
  `Author/Committer/GPG Key/Message` via `raw()` — 6-7 lines of mostly static
  boilerplate.

- `section()` in simple/pretty emits a blank line + banner to stdout (output.ts:257-261)
  — pure chatter on the data channel; raw() human chatter (doctor.ts:62-70,
  clean.ts:249, backlog.ts:92-93,127-128) bypasses GIWT_LOG by design
  (output.ts:240-242) yet carries no payload a script consumes.

- Already fine (leave alone): the run-record announce (runlog.ts:138, contract-asserted
  in e2e-isolation.test.ts:193), failing-check tails (finalize/checks.ts:161-190,
  bounded by `output.stream_tail`), `giwt git` reads, `giwt ledger --last 5` (327 B),
  `giwt runs` human, abort recovery state (abort.ts:254-260, rare + safety-critical).

Design:

1. `outcomeLine(ok: boolean, summary: string, runId?: string)` in src/utils/output.ts →
   `ok <cmd> <summary> · run <id-prefix>` / `fail <cmd> <summary> · run <id-prefix>`.
   The id-prefix stays dereferenceable because `resolveRunDir` (runs.ts:49-71) accepts
   prefix matches. Call it at the end of the mutating commands (commit, commit-wt,
   finalize, create, new-branch, sync, clean, tmp, doctor apply, rebase, abort).
   Handlers that already end in one clear line (gripe.ts:54-55) switch to the helper.

2. Demote boilerplate: the four commit context lines (commit-wt.ts:150-153,
   commit.ts:125-128) become one `log("debug", ...)` multi-line string; the same facts
   already land in the run record via `beginRun`; the success line carries
   `✅ <short-sha> <subject>` (identical to the ledger enrichment, ledger.ts:274-277).

3. Finalize preamble: `printRecentLedger(config.treeDir, 10)` (finalize/run.ts:40)
   moves behind `--show-ledger` / GIWT_LOG=debug; the console keeps the banner plus the
   outcome line — the shared-state view is one `giwt ledger --last 10` away.

4. Channel hygiene: drop `section()`'s double blank line in simple format to one
   (output.ts:245-261); keep simple on stdout for humans.

5. Document the contract in AGENTS.md ("Logging" section).

Tradeoffs: tests asserting substrings of the demoted lines (e.g. commit tests on
`Author:`) move with the change — mechanical. Humans recover commit context via
GIWT_LOG=debug (gate exists, output.ts:96-98).

**Acceptance Criteria:**

- [ ] `outcomeLine()` exists in src/utils/output.ts and emits `ok|fail <cmd> <summary> · run <id-prefix>`; the id-prefix resolves via `giwt runs`/`resolveRunDir`
- [ ] Every mutating command (commit, commit-wt, finalize, create, new-branch, sync, clean, tmp, doctor apply, rebase, abort) ends stdout with exactly one outcome line
- [ ] Commit `Author/Committer/GPG Key/Message` lines are debug-gated; success line carries short-sha + subject
- [ ] Finalize stdout no longer prints the 10-record ledger preamble without `--show-ledger` or GIWT_LOG=debug; `giwt ledger --last 10` output is unchanged
- [ ] AGENTS.md "Logging" section states the stdout contract
- [ ] `bunx tsc --noEmit` clean; `bun test` green (moved `Author:` assertions updated)
