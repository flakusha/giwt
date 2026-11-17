<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul channel record conflict integration

**Status:** Not Started
**Priority:** medium
**Effort:** large
**Tags:** pijul
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Broader pijul integration after the policy gate. Human decisions from .tmp/research/pijul/OPEN-QUESTIONS.md: #1 channel-per-agent vs clone-dir-per-agent topology; #2 version pinning (protocol/signature breaks between betas; workstation has beta.24, newest beta.26); #5 identity provisioning via ssh-agent versus .credentials.env GPG; #8 git interop posture (one-shot lossy import; bridge not shipped); #9 conflict UX via pull --json and --accept-conflict-markers; #10 finalize strategy collapse; #11 shared hooks approval; #12 passthrough-only vs pijul-native commands; #13 whether to proceed before a stable 1.0/git bridge. Record decisions before code.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
