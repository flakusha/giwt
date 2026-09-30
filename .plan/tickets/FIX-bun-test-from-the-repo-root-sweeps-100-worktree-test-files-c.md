<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: bun test from the repo root sweeps 100 worktree test files, causing spurious failures

**Status:** Done
**Priority:** high
**Effort:** Medium

**Summary:**

bunfig.toml [test] has no pathIgnorePatterns, and the 'test' script is a bare 'bun test' with no path filter. Every test file inside a tree/ worktree is therefore collected alongside the 49 real files in src/, so a root-level bun test runs ~149 files instead of 49.

**Context:**

Measured 2026-09-26 at master 8853725:

- test files under tree/: 100
- test files under src/: 49
- package.json:19  "test": "bun test"
- bunfig.toml [test] contains only coverageSkipTestFiles and coverageReporter

Symptom: a root-level 'bun test' reports 'Ran 2591 tests across 148 files' with 16 failures, most of which are not real. Failures name paths inside other worktrees — tree/tooling-unified-index/src/finalize-signal-safety.test.ts, tree/giwt-tooling-2026-09-26/src/commands/ticket.test.ts, tree/giwt-tooling-2026-09-26/src/utils/worktree-root.test.ts. Those are stale copies of suites that pass in their own worktree, and they collide with the root suite over process.cwd() and process.env because bun runs every collected file sequentially in one process.

Impact: any agent or developer who runs 'bun test' at the repo root instead of 'bun test src/' gets an unusable signal — real failures buried under failures from stale worktree copies. The pre-commit gate is unaffected because it runs the suite from inside a worktree, where tree/ does not exist, which is why this went unnoticed.

Fix: add pathIgnorePatterns = ["tree/**"] to the [test] section of bunfig.toml, matching the convention already used in the loop-lore repo (bunfig.toml:16). One line, no test changes. Scoped invocation (bun test src/) keeps working — pathIgnorePatterns applies to discovery, not to explicit path arguments.

Regression check: 'bun test' from the repo root must report 49 files, not 148. 'bun test src/' must be unchanged. 'bun run check' must stay green.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
