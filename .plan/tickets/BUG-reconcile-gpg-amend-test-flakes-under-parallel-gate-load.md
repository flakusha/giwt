<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: reconcile gpg amend test flakes under parallel gate load

**Status:** Not Started
**Priority:** low
**Effort:** Medium
**Tags:** gpg, flaky, tests

**Summary:**

reconcile-conflicts.test.ts 'pinned sign flags reach the reconcile amend commit' failed once during a full-suite gate run with 'gpg failed to sign the data' (SIG_CREATED then fatal: failed to write commit object), then passed on rerun and in a local full-suite run. GPG agent contention under the gate's parallel fan-out is the likely cause. AC: the test is deterministic under -j parallel load (serialize the gpg-dependent tests, pre-warm the agent, or retry once on sign failure); two consecutive full-suite green runs.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
