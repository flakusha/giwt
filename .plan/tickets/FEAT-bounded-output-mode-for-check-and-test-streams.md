<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: bounded output mode for check and test streams

**Status:** Done (landed on master: [output] stream_tail setting, bounded check/test failure tails, argv-fidelity test)
**Priority:** medium
**Effort:** Small

**Summary:**

Symptom: gate-running commands flood stdout, and agents cannot pipe to trim because harness shells block pipe shapes — so they rebuild truncation around giwt.

**Context:**

Evidence (2026-09-18):

- finalize writes test.log of 1.0 MB per run (8 runs today in loop-lore) and streams check output to the console; agents pipe through `tail -30/-40` to cope.
- glm session 2026-09-18T00-34-50 @ 00:58:55: the omp bash interceptor rejected the `cd <wt> && giwt finalize ... 2>&1 | tail -40` shape twice; the agent dropped the pipe and ran bare, eating full output.
- minimax session 2026-09-18T01-53-10 (from 02:08 onward): agents switched to JS eval wrappers running Bun.spawnSync(["giwt", ...]) capturing "stdout last 100" lines plus exit codes — i.e. hand-rolled bounded capture that giwt should provide.

Acceptance:

- check/test stream output on stdout is capped (default N lines, configurable via settings, e.g. [output] stream_tail) with a final "full output: `<capturePath>`" pointer.
- Full output still lands in the run-record capture files as today.
- The eval-wrapper pattern becomes unnecessary: a single bare invocation yields bounded, readable output.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
