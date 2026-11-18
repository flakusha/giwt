<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: missing git-issue subcommand is reported as a corrupt registry

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

When git-issue is uninstalled, 'git issue ls --all' exits 1 with stderr "git: 'issue' is not a git command". src/tickets/sync-registry.ts:83 only treats exit 127/ENOENT as missing, so readGitIssues classifies this as reason 'failed'; giwt sync --fix then prints 'git issue ls failed (exit 1: ...)' and tells the user to inspect a registry that does not exist. Add a distinct missing-issue-cli class with an install-git-issue remedy, keep the existing missing-git and failed-store classes, and test both a PATH shim that emits the not-a-git-command message and the real CLI.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-11-18T06:08:56.260Z closed after residual patches and index sync
