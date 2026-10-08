<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: giwt lifecycle config writes invisible to omp guard

**Status:** Not Started
**Priority:** low
**Effort:** Small
**Tags:** policy, config

**Summary:**

10 git-config write call sites in src/ are giwt child processes, invisible to the omp bash-hook guard (which gates raw `git config` commands, not giwt subcommands). Sites: src/utils/config.ts:133-134 (configureGpgSigningSilently: commit.gpgsign, user.signingkey), src/commands/sign.ts:50-58 (same + core.hooksPath), src/commands/create.ts:114 (core.hooksPath), src/commands/new-branch.ts:93 (core.hooksPath), src/commands/doctor/apply.ts:142-155 (pull.ff, branch.*.rebase, core.hooksPath), and the generated .install.sh line in src/doctor/generators/hooks.ts:294. These are deliberate lifecycle writes (GPG signing, hooksPath), not identity forging — but the omp policy says "agents must never modify git config" and giwt's own writes are ungated. Pre-existing since a95dd9f2/a6b34ff8.

**Context:**

The omp bash-hook guard intercepts raw `git config` commands and blocks them. However, giwt subcommands that internally call `git config` are not intercepted because they appear as `giwt sign`, `giwt create`, etc. — not as `git config`.

This creates a policy gap: the omp rules say agents must never modify git config, but giwt's own lifecycle writes (GPG signing setup, hooksPath configuration) are ungated.

These are deliberate, sanctioned writes — not identity forging. But the policy should either explicitly exempt them or giwt should add its own guard.

**Acceptance Criteria:**

- [ ] Either (a) document these as sanctioned lifecycle writes in the omp rules (git-config-blocklist.md) with an explicit giwt-subcommand exemption, or (b) add a giwt-level guard that logs/asks before these writes when an identity gate is present
- [ ] Decision is justified in the ticket or PR
- [ ] If option (a): git-config-blocklist.md updated with exemption
- [ ] If option (b): guard implemented with tests
