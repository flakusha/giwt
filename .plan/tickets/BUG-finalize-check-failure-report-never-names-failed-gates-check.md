<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize check-failure report never names failed gates (checks[].command schema ignored)

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** finalize, reporting

**Summary:**

`giwt finalize`'s check-failure report (`reportCheckFailure` in src/commands/finalize.ts) filters `checks[]` entries on `check.name`, but the real check-runner schema (loop-lore `.tmp/check-report.json`, schemaVersion 1) identifies checks by `command` ("bun run typecheck") and carries `output: null` when quiet. The filter is always false → `failed` stays empty → the report falls back to dumping the runner's raw stdout tail (mangled PASS lines) and never names the failed gate. A failing code-map gate was invisible for three consecutive finalize attempts because of this.

**Context:**

Reproduced 2026-09-26: parsed loop-lore's real report — root keys `schemaVersion, generatedAt, runner, cwd, runId, mode, worktreeName, branch, gitHead, gitDirty, gpgPrecheck, passed, exitCode, reportPath, summary, checks, nonBlocking`; `checks[i] = {command, passed, exitCode, durationMs, output, truncated}` — no `name` field anywhere. finalize.test.ts fixtures pinned the wrong schema (`name`), so the suite stayed green while the real path broke.

**Acceptance Criteria:**

- [x] `reportCheckFailure` accepts both `name` and `command` identifiers; `output` may be null
- [x] Failing check prints `✗ <identifier>` plus its first non-empty output line
- [x] Regression test uses the real runner shape (`command`, `output: null` on passing checks) and fails against the old code
- [x] Existing finalize tests still pass (back-compat with `name` fixtures)

Fixed in 5adb4c4 (worktree branch, finalized to master). The empty-report fallback now labels the stdout tail ("no failing gate found in the check report — showing the runner's stdout tail:"). Related duplicate: FIX-finalize-cannot-name-the-failed-gate-report-schema-drops-the (0b773e3, closed as duplicate).

git issue: 3022ea0
