<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul VCS support

**Status:** In Progress
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, pijul
**Related:** FEAT-feat-vcs-backend-seam-and-backend-setting.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Implement the `pijul` backend behind the landed VCS seam (`src/vcs/{types,registry,git}.ts`). Full research: `.tmp/research/pijul/` (NOTES, INVENTORY, OPEN-QUESTIONS).

**Decisions (2026-11-18, user-approved):**

- Both native backends are in scope; pijul topology is **clone-dir-per-agent** — each agent gets its own clone directory, so there is no shared working copy and no channel-per-agent switching (`pijul fork`/`channel switch` refuse on unrecorded changes anyway).
- Ticket substrate is **unsupported in pijul mode**: git-issue has no pijul equivalent, so giwt must explicitly refuse with docs — no side git repo and no silent `.plan`-only fallback.
- Until this backend lands, `pijul` remains a known enum value that refuses at settings load; once it lands, settings load accepts it and `resolveVcsBackend` returns the pijul backend. No git fallback at any stage, and settings-load refusal stays the safety net for unimplemented backends.
- Pijul-specific primitives are mandatory: clone-dir-per-agent for `createWorkspace`, `pijul record` instead of commit, ahead/behind recomputed from change-hash sets, commutation instead of rebase, conflicts as first-class changes, inherent sshsig signing (no GPG).
- Version policy: pin the installed beta exactly and hard-refuse mismatches (protocol/signature format broke between betas); doctor reports the resolved version. Deployment expects a user-provisioned SSH identity/agent with a remedy on failure.

**Acceptance Criteria:**

- [ ] `PijulBackend` implements the seam ops with pijul primitives; `createWorkspace`/`removeWorkspace` provision and remove a per-agent clone dir with no shared WC and no channel switch.
- [ ] Settings load accepts `backend = "pijul"` only once the backend lands; before landing the refusal is unchanged. Never a git fallback — a test asserts no git argv runs in pijul mode.
- [ ] The unsupported ticket substrate is an explicit refusal plus documentation; no side git repo is created.
- [ ] `status` recomputes ahead/behind from change-hash sets; `commit` maps to `pijul record`; immutable change hashes mean no rebase/skip-ledger rewrite.
- [ ] Missing pijul on PATH or a version mismatch produces a clear error with the identity/agent remedy and never runs git.
- [ ] `.pijul/pristine` is excluded from hot backups with a loud warning; a doctor `pijul` check reports backend/version.
- [ ] Identity/GPG policy stays in the command layer; inherent sshsig signing is documented as a deviation.
- [ ] `bun run check` passes; every new file carries an SPDX header.

**Not in this ticket:** finalize/rebase/abort rewrite, `giwt pijul` passthrough table, git-interop bridge.
