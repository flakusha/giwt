<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: errors.test.ts leaks process.env.REPO_ROOT into later test files, breaking loadConfig tests

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** fix

**Summary:**

src/utils/errors.test.ts sets process.env.REPO_ROOT = root in four tests but never unsets it. afterEach only rmSync's the temp dir, leaving REPO_ROOT pointing at a deleted path. Bun runs test files sequentially in one process, so every later test file inherits the dangling variable.

Symptom: src/utils/worktree-root.test.ts 'loadConfig splits worktreeRoot from repoRoot inside a worktree' fails deterministically in the full suite with ENOENT on realpathSync(config.worktreeRoot), naming a giwt-errors-* path. It passes when the file runs alone.

**Context:**

Root cause chain: errors.test.ts beforeEach deletes REPO_ROOT/TREE_DIR, the test body sets REPO_ROOT = root, afterEach removes root but not the variable. worktree-root.test.ts then does process.chdir(wt) into a fresh repo and calls loadConfig(), which treats REPO_ROOT as an opt-in escape hatch that overrides cwd (config.ts:55). It returns the deleted giwt-errors-* dir, so realpathSync throws ENOENT.

The test's own chdir is correct and is not the bug; the env leak is. This is deterministic, not a flake: 3/3 full-suite runs fail identically (861 pass, 1 fail across 49 files). Reproduces with just the two files: bun test src/utils/errors.test.ts src/utils/worktree-root.test.ts.

Note: this is the exact hazard giwt AGENTS.md already documents for GIT_* vars ('a mock.module without an afterAll restore poisons later test files in the same process') — same class of leak, one layer over. A repo-wide sweep for tests that assign process.env without unsetting is worth a follow-up; this ticket fixes the confirmed instance.

**Acceptance Criteria:**

Fix: afterEach in errors.test.ts must delete process.env.REPO_ROOT and process.env.TREE_DIR alongside rmSync, so the escape hatch does not outlive the fixture. Move the deletes from beforeEach into afterEach (keeping beforeEach is harmless but the afterEach is the required half).

Regression test: none needed beyond the existing one — the fix is validated by bun test src/utils/errors.test.ts src/utils/worktree-root.test.ts going green, and by the full suite returning 862 pass / 0 fail.

git issue: d37af3e
