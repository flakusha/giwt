<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: logger internals: run correlation, fields, warnOnce, raw hygiene

**Status:** Done
**Priority:** low
**Effort:** Medium
**Tags:** output, logging, cli

**Summary:**

Logger-internal improvements: tie machine-format log events to the run dir, allow
optional structured fields on log(), centralize warn-once, and sweep raw() back to
payload-only so usage chatter stops breaking the clean-stdout guarantee under machine
formats.

**Context:**

Evidence (proposals doc 2026-10-14, P6):

- **No console↔run correlation.** Machine-format log events are `{ts, level, msg}` only
  (src/utils/output.ts:199-205); nothing ties a stderr JSON line to the run dir
  announced on stdout (src/utils/runlog.ts:138).

- **No structured fields.** `log(level, message: string)` — callers interpolate (60+
  sites); json/jsonl/toml formats can't carry typed key/values.

- **raw() used for human chatter** that bypasses GIWT_LOG entirely: abort.ts:254-260,
  doctor.ts:62-70, clean.ts:249, backlog.ts:92-128 — plus the
  `log("error") + raw("  Usage: …")` idiom in 20 command files / 21 sites (grep
  `raw("  Usage`: runs.ts:227-229, clean.ts:84-86, attach.ts:15-17, attach-dir.ts:15-16,
  comment.ts:14-15, gripe.ts:32-34 + 47-49, ticket/copy.ts:60-63, …) puts usage text on
  stdout after an error on stderr — under machine formats the "clean stdout" guarantee
  (output.ts:170-176) is broken by those usage lines.

- **Warn-once is ad hoc**: invalid GIWT_LOG / GIWT_OUTPUT warn once via module-load
  guards (output.ts:61-71, 129-156); settings warn-on-unknown-key lives in settings.ts
  — each site hand-rolls its "already warned" flag.

- Constraint: the perf budget note (output.ts:178-184) forbids per-event parsing — any
  change must stay O(1)/event.

Design:

1. Run context: module-local `setRunContext(runId: string | null)` in output.ts, called
   by `beginRun` (runlog.ts:136) and cleared in `finish`; `render()` includes
   `"run": runId` in json/jsonl/toml events only (one field, still O(1)).

2. Optional fields param: `log(level, msg, fields?: Record<string, string|number>)`;
   simple/pretty append nothing (document that: never print fields there, preserving
   the P3 low-context contract); machine formats serialize the object. Existing
   two-arg calls unchanged — purely additive overload.

3. Central `warnOnce(key: string, msg: string)` in output.ts (a `Record<string, true>`
   plus one `log("warn", ...)` call); refactor the 3-4 existing hand-rolled sites to it.
4. raw() hygiene: keep raw() strictly for payloads (docs dump, renderRecords output,
   formatRecord dump). Convert the usage-after-error idiom to
   `log("error", "usage: giwt …")` so both lines share stream/gating rules; convert
   doctor detect / abort state / clean per-class lines to `log("info", …)`.

Tradeoffs: tests asserting `process.stdout.write` for usage text see it move to stderr
(capture helpers that join both streams already exist, e.g.
commands/report.test.ts:29-30; most assertions are content-only). Wide but shallow
sweep (~25 raw sites), each a channel/level change, not logic.

**Acceptance Criteria:**

- [ ] json/jsonl/toml log events carry a `run` field matching the active run id; absent (not null) when no run is active; simple/pretty output unchanged
- [ ] `log("warn", "x", { key: 1 })` serializes `key` in machine formats and prints nothing extra in simple/pretty
- [ ] `warnOnce(key, msg)` warns exactly once per key per process; the GIWT_LOG/GIWT_OUTPUT/settings sites use it
- [ ] No `raw("  Usage` remains in src/commands/ (grep count 0); usage-after-error goes through log("error", ...)
- [ ] A `--json` invocation's stdout still parses as clean JSON (no usage contamination) — e2e-style test
- [ ] `bunx tsc --noEmit` clean; `bun test` green (moved usage assertions updated)
