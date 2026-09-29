<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: plan validate: scope ticket-format/link gates to the diff base

**Status:** Done
**Priority:** high
**Effort:** medium
**Epic:**
**Tags:** plan,validate,finalize,parallel-sessions

**Summary:**

plan validate runs every gate over the entire .plan/tickets/ directory on every invocation — there is no diff-scoping. This makes `giwt finalize --plan-gates` fail on foreign tickets written by concurrently-active sessions in the same repository, even on branches that never touched .plan/.

**Context:**

`runValidate` (src/plan/validate.ts) accepts only fixed-directory options. `src/commands/finalize.ts` already resolves a merge-base via `resolveDiffBase` and forwards it to the project check command, but never to the in-process `runValidate` call. Observed twice on loop-lore 2026-09-26.

**Acceptance Criteria:**

- [x] `runValidate` accepts an optional `diffBase`; when set, per-file gates (format, linkage, status-vocab) inspect only ticket/epic files changed vs that ref plus untracked files.
- [x] Freshness/cross-file gates (code-map, matrix, epics-doc, naming, links, backlog, tickets, spdx) stay global.
- [x] finalize passes the resolved diff base into runValidate, gated by `[commands] diff_base` (default true).
- [x] Without `diffBase`, behavior is unchanged (full scan).
- [x] Untracked malformed tickets are still caught; foreign tickets are not.
- [x] `readGitIssues` timeout (10s → 60s, injectable) no longer folded into "git issue CLI unavailable"; slow registry reported distinctly.

## Notes

Companion fix: `git issue ls --all` at 3.3k+ issues exceeded the old 10s execSync timeout and `plan sync --fix` refused while blaming a missing tool (broke a sibling agent's finalize on bug-mitigations).

git issue: c5d6516
