<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: getTrackedFiles default git runner throws on every invocation: whole-tree spdx-check never checks a file

**Status:** Done
**Priority:** critical
**Effort:** Small
**Epic:** spdx-compliance
**Tags:** spdx, discovery, bug

**Summary:**

spdx-discovery.ts:11 sets the default git runner to 'await $`${command}`.text()'. Bun's shell does NOT word-split an interpolated string, so the whole command line is passed as a single executable name. Bun then fails with 'bun: command not found: git ls-files' and the promise rejects.

Every whole-tree invocation of spdx-check therefore dies before a single header is examined. Measured 2026-10-14 on giwt master:

    getTrackedFiles() -> THREW: Failed with exit code 1
    bun src/cli.ts spdx-check -> exit 1, stdout = only the run-record line, zero violations listed

The argv form works and returns 549 files, so this is purely the interpolation shape:

    await $`${['git','ls-files']}`.text()   -> OK (549 lines)
    await $`${"git ls-files"}`.text()      -> THROWS 'bun: command not found: git ls-files'

Why it is not caught: spdx-discovery.test.ts mocks the runner via setGitRunner for both getTrackedFiles and getStagedFiles, and its afterEach restores the same broken default. The tests therefore assert only that the returned string is filtered, never that a real git invocation works. The default runner is dead code as far as the suite is concerned.

Impact beyond spdx-check: getStagedFiles shares the identical default runner, so '--staged' mode is broken the same way, as is any other caller that does not install a runner. This also means the spdx gate cannot currently protect the repo at all — it reports failure for the wrong reason, which is a false signal in both directions.

Note this defect is INDEPENDENT of the checkHeader comment-suffix parser bug; fixing one does not fix the other, and both must land for the gate to function.

Resolution: fix landed as `655422d` (discovery spawns git via Bun.spawnSync).

**Acceptance Criteria:**

- [ ] The default git runner invokes git with an argv array, or the command string is split into argv, so 'git ls-files' resolves as a command plus argument rather than one executable name
- [ ] getTrackedFiles and getStagedFiles both work against a real repository with no injected runner
- [ ] A test exercises the real default runner (no setGitRunner mock) and asserts a non-empty file list, so this cannot regress silently
- [ ] The test afterEach restores a runner that is itself verified working, rather than reinstalling the broken default
- [ ] 'bun src/cli.ts spdx-check' with no arguments completes and reports a real violation count rather than exiting 1 with no output
- [ ] Documentation updated

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)
