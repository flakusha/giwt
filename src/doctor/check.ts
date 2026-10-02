// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Doctor health checks — run repo-health tools and report findings.
 *
 * Inventory (mirrors omp `/find-work` tool sources so the two stay
 * mutually intelligible):
 *   lint       configured linter: eslint > biome > oxlint
 *   typecheck  tsc --noEmit (tsconfig.json present)
 *   tests      package.json test script (command from settings.commands.test)
 *   knip       unused exports/dependencies (knip configured)
 *   jscpd      copy-paste clones (jscpd configured)
 *   todo       TODO/FIXME comments in code (pure FS scan)
 *   leaks      openers of src test files with no teardown (pure FS scan)
 *   scratchpad .tmp scratchpad bloat — total bytes, orphan *.tmp count,
 *              oldest artifact age, largest dirs (pure FS, scanScratch)
 *
 * Machine contract (omp `/find-work` consumes this):
 *   giwt doctor check --json  →  DoctorCheckReport JSON on stdout. NOTE:
 *   giwt's dispatcher prints a run-record announcement line before command
 *   output, so consumers must parse from the first `{`, not from offset 0.
 *   Finding severity/kind map 1:1 to work tickets: error/bug = must-fix,
 *   warning/task = hygiene. Exit code is 1 when any error-severity finding
 *   exists or a check fails to run, else 0 — warnings alone never fail.
 *
 * Runners shell out via Bun.spawn under a hard budget
 * (CHECK_TIMEOUT_DEFAULT_MS, overridable via `[doctor] timeout_ms` or
 * `doctor check --timeout <ms>`). A child exceeding the budget is killed
 * and its check reports a timeout error naming the command and the
 * budget, so a wedged tool cannot hold a worker slot forever. Every
 * runner is best-effort: a nonzero exit with parseable findings still
 * yields tickets; a nonzero exit with none becomes a check error
 * carrying the output tail.
 */

/**
 * Implementation lives in `check/` submodules; this file stays the public
 * module path — every historical named export is re-exported from here
 * (colocated tests and src/index.ts depend on the stable surface).
 */

export type { CheckFinding, CheckId, CheckResult, CheckSeverity } from "./check/types.ts";
export { CHECK_IDS, CHECK_MAX_FINDINGS } from "./check/types.ts";
export type { DoctorCheckReport } from "./check/types.ts";

export type { LintFinding, TestFailure, TscError } from "./check/parse.ts";
export {
  parseBiomeOutput,
  parseEslintJson,
  parseOxlintJson,
  parseTestOutput,
  parseTscOutput,
} from "./check/parse.ts";

export type { CloneFinding, KnipFinding } from "./check/tools.ts";
export { parseJscpdReport, parseKnipIssues } from "./check/tools.ts";

export type { TodoMatch } from "./check/todo.ts";

export type { SpawnFn } from "./check/spawn.ts";
export { CHECK_TIMEOUT_DEFAULT_MS } from "./check/spawn.ts";

export { runLeaks, runScratchpad } from "./check/scans.ts";

export type { DoctorCheckOptions } from "./check/entry.ts";
export {
  applicableChecks,
  checkExitCode,
  DOCTOR_PER_WORKER_MEM_MB,
  effectiveJobs,
  runDoctorChecks,
} from "./check/entry.ts";
