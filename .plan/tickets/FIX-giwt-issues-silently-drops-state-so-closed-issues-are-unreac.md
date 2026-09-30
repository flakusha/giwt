<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: giwt issues silently drops --state, so closed issues are unreachable

**Status:** Done
**Priority:** medium
**Effort:** Medium

**Summary:**

src/commands/issues.ts never forwards --state to 'git issue ls' and its flag switch has no default branch, so an unrecognized flag is dropped without error and consumes zero args. A user who asks for closed issues gets the default open listing instead, with no warning.

**Context:**

Repro (2026-09-26, master d40da74):
  $ giwt issues --state closed
  no issues found
while these three closed issues demonstrably exist:
  $ giwt show 0b773e3 | head -2
  Issue 0b773e3 [closed]
  $ git issue ls --state all --format oneline   # lists 34, all closed

Two distinct bugs:

1. No passthrough. 'git issue ls' already supports -s/--state <open|closed|all> [default: open] and -a/--all. giwt ignores both and calls 'git issue ls --format' with a hardcoded oneline format, unconditionally (issues.ts:28).
2. Silent swallow. The switch at issues.ts:12-25 handles only --all/-a and --format/-f. With no default branch, '--state' and its value are both consumed as no-ops, so the command still exits 0 and prints a plausible-looking listing. That is worse than an error: the output is wrong rather than absent.

Implementation notes:

- Only the space form works at the git layer. '--state=all' errors with 'unknown option'; '--state all' is correct. The passthrough must split on argv position, not assume --flag=value.
- The non-all path is hard-capped at 50 (issues.ts:36-37) with no truncation notice, so a large registry silently under-reports.
- 'find-work' is a known consumer that needs migrating once --state lands.

Placement note: an earlier copy of this work was filed in the LOOP-LORE repo's .plan/tickets/ — against the wrong repository. This issue supersedes it; the loop-lore copy can be closed or removed. This ticket is filed in giwt because the code under test is src/commands/issues.ts here.

Regression test: 'giwt issues --state closed' must list closed issues; 'giwt issues --state open' must list open ones; an unknown flag must exit non-zero with a usage line rather than silently succeed.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
