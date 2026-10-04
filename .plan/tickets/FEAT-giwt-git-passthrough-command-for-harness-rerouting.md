<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: giwt git passthrough command for harness rerouting

**Status:** Done
**Priority:** high
**Effort:** Medium
**Epic:** git-rerouting-safety
**Tags:** git, rerouting

**Summary:**

giwt git (args...): classify invocation, exec git once (exit code passthrough), full stdout+stderr to run-record capture, git:SUB event, rtk minimal-context console output for RO commands when rtk available ([git] rtk auto|on|off). Harness reroutes raw git here.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-04T02:00:46.503Z Landed: src/commands/git.ts (classify + exec-once + run-record git-output.txt + exit passthrough + rtk writeConsole); policy in src/git/policy.ts; tests commands/git.test.ts; harness reroute via omp-plugins pre-git-giwtroute
