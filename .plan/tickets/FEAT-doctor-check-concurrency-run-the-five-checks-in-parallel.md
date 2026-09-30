<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: doctor check concurrency - run the five checks in parallel

**Status:** Done
**Priority:** high
**Effort:** Medium

**Summary:**

**Context:**

Measured from omp /find-work on loop-lore (2026-09-18): giwt doctor check --json --checks lint,typecheck,tests,knip,jscpd runs the checks SEQUENTIALLY via Bun.spawnSync with no internal timeouts (src/doctor/check.ts, runChecks for-loop) and exceeded 360s without finishing (killed externally). The omp side now bounds the call at 120s (TOOL_CLUSTER_BUDGET_MS, omp-plugins find-work tool-cluster), so doctor gets killed mid-run on large repos and its findings never arrive.

Triage of WHICH external tool calls run is not possible (all five checks are required), but CONCURRENCY is: run the check runners concurrently instead of the sequential for-loop.

Proposal: swap the synchronous for-loop + Bun.spawnSync for Bun.spawn + Promise.allSettled over the applicable checks, collecting CheckResults in stable DOCTOR_CHECKS order for identical --json output shape. The four analyzers (lint, typecheck, knip, jscpd) are read-only and safe beside each other; the tests runner is the only stateful one, and analyzers-vs-tests concurrency is already proven safe downstream (omp find-work direct fallback runs all five in parallel). Keep defaultSpawn's no-internal-timeout policy (operator owns cancellation) and keep checkExitCode semantics. Evidence anchor: omp-plugins bench - roster 435ms vs doctor >360s; sibling followup FW-05/SPLIT-01 in omp-plugins.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
