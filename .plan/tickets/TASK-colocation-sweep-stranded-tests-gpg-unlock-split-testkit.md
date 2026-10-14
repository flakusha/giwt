<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: colocation sweep: stranded tests, gpg-unlock split, testkit

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Tags:** refactor, testing, structure

**Summary:**

Colocation cleanup: move stranded test files next to their subjects, split the
root-level gpg-unlock command into commands/ + utils/gpg primitives, relocate the
finalize-lock fixture into a testkit, and introduce shared testkit capture + git-repo
helpers for the 49 files hand-rolling capture.

**Context:**

Evidence (proposals doc 2026-10-14, P7):

- **Command at src root, violating the naming rule** (AGENTS.md:64: command keys must
  match their `src/commands/<key>.ts` module; sole exception `new` →
  new-branch.ts): `gpg-unlock` is a registered command ("gpg-unlock" in
  cli-registry.ts:140-143) but lives at src/gpg-unlock.ts (251 L, size-allow: 300).
  Its reusable halves — `probeCachedPassphrase`, `warmCacheViaPassphrase`,
  `effectiveCacheTtl` — are imported by src/utils/gpg.ts:49 and consumed by
  commit/commit-wt/sign/finalize (utils/gpg.ts:152-154), i.e. a *util* living in a
  *command* file.

- **Stranded tests at src root**, subjects elsewhere: src/gripe.test.ts:21 imports
  `./commands/gripe`; src/report.test.ts:7 imports `./commands/report` **and**
  src/commands/report.test.ts:17 imports `./report` — the same command has two test
  files in two directories (106 L + 600 L, overlapping check-report.json fixtures);
  src/finalize-args.test.ts:28 imports `./commands/finalize.ts`;
  src/resolve-diff-base.test.ts:30 imports `./commands/finalize` (subject is
  `resolveDiffBase` in src/commands/finalize/checks.ts:29);
  src/utils/worktree-root.test.ts:18-19 tests `findRepoRoot`/`getWorktreeRoot` from
  `./git` — name matches neither git.ts nor the unrelated worktree-probe.ts (17 L).
  Cross-cutting integration files (e2e-isolation, finalize-signal-safety,
  finalize-lock-cleanup) at src root are fine where they are.

- **Fixture placement**: src/finalize-lock-fixture.ts is spawned, never imported
  (AGENTS.md:79); spawned from finalize-lock-cleanup.test.ts and
  src/commands/finalize-lock-queue.test.ts:37. Production-tree plumbing for tests
  only.

- **49 test files hand-roll the same capture helper** (grep
  `spyOn(process.stdout, "write")` in *.test.ts), 10-20 lines each; the
  `mkdtempSync(join(scratchRoot(), "giwt-<slug>-")) + git init + identity` preamble
  repeats in 84+ files (grep `scratchRoot()`).

- **Public API unaffected**: src/index.ts re-exports nothing from gpg-unlock.ts, so
  moves are internal.

Design:

1. `git mv src/gpg-unlock.ts src/commands/gpg-unlock.ts`; move `probeCachedPassphrase`,
   `warmCacheViaPassphrase`, `effectiveCacheTtl` (+ `loadCredentials` usage) into
   src/utils/gpg.ts; leave `runGpgUnlock()` as the command body. Update importers:
   cli-registry.ts:52, utils/gpg.ts:49, gpg-unlock.test.ts, gpg.test.ts:28.

2. Moves: gripe.test.ts → src/commands/gripe.test.ts; merge src/report.test.ts into
   src/commands/report.test.ts (keep the richer 600 L file, port the corrupt-report
   case it uniquely covers); finalize-args.test.ts + resolve-diff-base.test.ts →
   src/commands/; rename utils/worktree-root.test.ts → utils/git-worktree-root.test.ts
   (or fold into git.test.ts).

3. `git mv src/finalize-lock-fixture.ts src/testkit/finalize-lock-fixture.ts`; update
   the two FIXTURE_PATH sites and AGENTS.md:79,102.

4. New src/testkit/capture.ts, parallel-safe by construction:
   `captureOutput()` → `out()/err()/lines()/restore()`, `restore()` the only
   spy-unwind path, invoked in `finally`/`afterEach`; offer `withCapture(fn)` that
   restores on throw. `makeGitRepo(slug, { branches, identity })` allocates a FRESH
   mkdtemp per call under `scratchRoot()`, spawns git under `isolatedGitEnv()`, and
   returns the root for the caller to `rmSync` in its own `finally` — no module-global
   registry, no fixed/shared paths. Migrate opportunistically (start with
   commit-protected.test.ts, seven inline capture copies). Add `src/testkit` to knip's
   ignore/entry list (test-only by construction).

Tradeoffs: moves churn blame and out-of-repo deep imports (none are in the exports
map); testkit is a new directory — one knip config line.

**Acceptance Criteria:**

- [ ] `gpg-unlock` command module lives at src/commands/gpg-unlock.ts; the three gpg primitives live in src/utils/gpg.ts; no src-root gpg-unlock.ts remains; importers updated
- [ ] gripe/report/finalize-args/resolve-diff-base/worktree-root test files sit next to their subjects; src/report.test.ts merged without losing the corrupt-report case
- [ ] src/testkit/finalize-lock-fixture.ts exists; both FIXTURE_PATH sites and AGENTS.md updated; finalize-lock-cleanup and finalize-lock-queue tests pass
- [ ] src/testkit/capture.ts provides captureOutput/withCapture + makeGitRepo with the documented parallel-safe resource contract; at least the worst-duplication file (commit-protected.test.ts) migrated
- [ ] knip config lists src/testkit; `bun run check` green (deadcode/duplication/size gates included); `bun test` green
