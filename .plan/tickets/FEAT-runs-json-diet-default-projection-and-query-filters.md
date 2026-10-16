<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: runs --json diet: default projection and query filters

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** runlog, agents, cli

**Summary:**

Shrink `giwt runs --json` from ~1.6 KB/run to a lean default projection and add
`--cmd`/`--branch`/`--failed` query filters. The machine surface — the one agents
actually parse — is the most expensive surface per bit of decision value, and it cannot
answer "did the last finalize fail?" without downloading everything.

**Context:**

Evidence (proposals doc 2026-10-14, P2):

- Measured: `giwt runs --last 2 --json` = 3,234 B stdout (~800 tokens). Cause:
  src/commands/runs.ts:233-239 inlines `events: readRunEvents(record.dir)` into every
  record, and `meta.args` carries the raw argv verbatim — the sampled ticket run's args
  embed an entire multi-paragraph ticket body.

- Default `last = 20` (runs.ts:216), so an agent asking "what happened lately" pulls
  ~15-30 KB before it can reason. No `--cmd`/`--branch`/`--failed` filter exists; the
  only selectors are `--last` and the triage/diff/stats subcommands.

- The human format is already good: 2 lines per run with dir + `formatOutcome`
  (runs.ts:255-268); `resolveRunDir` (runs.ts:49-71) accepts id prefixes.

Design:

1. Projection diet at runs.ts:233-239: default record becomes
   `{ cmd, branch, start, end, exitCode, outcome, dir, argsSummary }` where
   `argsSummary` = first 3 args + `argsTruncated: <n>` (each arg capped at 80 chars);
   full `args` and `events` opt-in via `--events` / `--full`. meta.json on disk is
   unchanged — purely the read projection (the comment at runs.ts:235-237 already
   frames events as a read-side join; make it a lazy join).

2. Filters: `--cmd <name>`, `--branch <b>`, `--failed` (exitCode ≠ 0 or
   outcome.failedGates non-empty), composable with `--last`. ~30 lines in the flag
   loop (runs.ts:216-231).

3. Keep `giwt runs triage|diff|stats` as-is — they already defer to files.

Tradeoffs: `args → argsSummary` is the compat break — acceptable at v0.x, and `--full`
restores byte-parity for old consumers. `--json` consumers wanting events pass
`--events`; the run `dir` field makes the follow-up read one `readRunEvents(dir)` away
(already exported from src/index.ts).

**Acceptance Criteria:**

- [ ] `giwt runs --last 5 --json` records contain no `events` array and no full `args`; they carry `argsSummary` (+ `argsTruncated` when args were cut) and `dir`
- [ ] `giwt runs --last 5 --json` total output is ≤ ~400 B/run on a typical repo (verify by measuring against the 3,234 B / 2 runs baseline)
- [ ] `--events` re-adds `events`; `--full` restores the pre-change byte shape for a fixture run
- [ ] `--cmd finalize`, `--branch <b>`, `--failed` each filter correctly and compose with `--last` (unit tests in src/commands/runs.test.ts)
- [ ] `giwt runs` human output and `triage|diff|stats` are unchanged
- [ ] `bunx tsc --noEmit` clean; `bun test src/commands/runs.test.ts` green
