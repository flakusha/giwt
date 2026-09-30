<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: run records die with the worktree and lack outcome data

**Status:** Done
**Priority:** high
**Effort:** Medium

**Summary:**

Symptom: .tmp run records cannot answer "what did this run do" — they are invocation stubs, they vanish when finalize removes the worktree, and error paths never finalize them.

**Context:**

Evidence (2026-09-18):

- giwt repo ledger shows 5 finalize entries today but main .tmp/giwt/runs has zero finalize dirs — run records are written under the WORKTREE root (runlog.ts documents `<worktreeRoot>`/<paths.runlog>/runs), and a successful finalize removes the worktree, deleting its own evidence. Failed finalize records survive only until the worktree is removed (seen under tree/tooling-plan-validate-integration/.tmp and loop-lore/tree/db-roundtrip-fix/.tmp).
- meta.json contains only cmd/args/said/pid/repoRoot/branch/start/end/exitCode (~250B). sync (10ms, exit 0) records nothing about ticket counts or applied fixes; `giwt runs --json` therefore cannot answer outcome questions without opening files.
- Dangling records on error paths: 20260918T012503-425103-new (error: base dev does not exist) and 20260918T013031-440738-doctor have meta without end/exitCode.

Acceptance:

- Run records live at repoRoot (or meta is mirrored there) so worktree removal preserves them.
- Error paths (handler throw, process.exit(1)) still write end + exitCode.
- meta is extended with an outcome summary (failing gates for finalize/check, merge commit for finalize, sync counts, doctor summary line).
- `giwt runs --last N --json` exposes the outcome fields.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
