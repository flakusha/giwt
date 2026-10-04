<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: reconcile gpg amend test flakes under parallel gate load

**Status:** Done
**Priority:** low
**Effort:** Medium
**Tags:** gpg, flaky, tests

**Summary:**

reconcile-conflicts.test.ts 'pinned sign flags reach the reconcile amend commit' failed once during a full-suite gate run with 'gpg failed to sign the data' (SIG_CREATED then fatal: failed to write commit object), then passed on rerun and in a local full-suite run. GPG agent contention under the gate's parallel fan-out is the likely cause. AC: the test is deterministic under -j parallel load (serialize the gpg-dependent tests, pre-warm the agent, or retry once on sign failure); two consecutive full-suite green runs.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-04T02:00:47.145Z Landed: 6e0ff45 replaced real gpg with deterministic PATH stub (SIG_CREATED shim) - no agent contention possible; >=2 consecutive green full-suite gates on 2026-10-04 (fullcheck + every gated landing)
