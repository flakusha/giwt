<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: git invocation allowlist policy + configurable lists

**Status:** Done
**Priority:** high
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, policy

**Summary:**

Err-closed subcommand policy in src/git/: RO/RW tables, per-subcommand predicates, [git] safe/allow/deny config lists (deny wins; builtin blocks not overridable). Config reads allowed (get/get-all/get-regexp/list, single positional), writes blocked (2 positional, set/unset/edit, add/unset-all/replace-all/remove-section/rename-section, -e, scope+write). Unknown subcommand blocked with hint.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-04T02:00:46.595Z Landed: src/git/policy.ts classifyGitInvocation + policy-tables.ts (RC_SUBCOMMANDS/RW/BLOCK, CONFIG_WRITE_KEYS, GPG_BYPASS_TOKENS), [git] safe/allow/deny settings (deny wins), unknown blocked with hint; git.test.ts+policy.test.ts
