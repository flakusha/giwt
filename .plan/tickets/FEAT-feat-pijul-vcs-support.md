<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul VCS support

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, pijul
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Research dossier: `.tmp/research/pijul/` (NOTES.md, INVENTORY.md, OPEN-QUESTIONS.md — 13 human-decision questions).

Key findings:

- pijul 1.0.0-beta only (beta.26); pin versions — protocol/signature broke between betas.
- No worktrees: channel-per-agent vs clone-dirs decision (open).
- Change hashes = intrinsic patch ids → skip-ledger dissolves.
- Signing inherent sshsig/ssh-agent (no GPG).
- Git interop = one-shot lossy import only; bridge promised but not shipped.
- Conflicts first-class.
- `giwt pijul` passthrough with draft policy table: unrecord/reset/channel-delete/-k/--config err-open.
- No ticket-issue substrate in pijul mode.
- Recommendation: minimal passthrough now OR wait for bridge — open question for human.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
