// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Doctor check entry: applicability, pool sizing, and the bounded worker
 * pool that runs the requested checks in order.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunRecorder } from "../../utils/runlog.ts";
import { DEFAULT_SCRATCH_CONFIG, DEFAULT_SCRATCHPAD_THRESHOLDS } from "../../utils/scratch.ts";
import { detectProject } from "../detect.ts";
import { hasTestFiles } from "../leaks.ts";
import { runLint, runTests, runTypecheck } from "./run.ts";
import { runLeaks, runScratchpad, type ScratchpadCheckOptions } from "./scans.ts";
import { boundedSpawn, CHECK_TIMEOUT_DEFAULT_MS, defaultSpawn, type SpawnFn } from "./spawn.ts";
import { runTodo } from "./todo.ts";
import { runJscpd, runKnip } from "./tools.ts";
import { CHECK_IDS, type CheckId, type CheckResult, type DoctorCheckReport } from "./types.ts";
import { readPkg } from "./util.ts";

const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "shell",
] as const;

/**
 * Which checks apply to root. Linter/tool presence comes from
 * detectProject (single source of truth shared with scaffolding);
 * tsconfig + test script are direct FS reads.
 */
export function applicableChecks(root: string): CheckId[] {
  const report = detectProject(root);
  const out: CheckId[] = [];
  if (report.existing.eslint || report.existing.biome || report.existing.oxlint) {
    out.push("lint");
  }
  try {
    if (existsSync(join(root, "tsconfig.json"))) out.push("typecheck");
  } catch {
    /* ignore */
  }
  if (typeof readPkg(root)?.scripts?.["test"] === "string") out.push("tests");
  if (report.existing.knip) out.push("knip");
  if (report.existing.jscpd) out.push("jscpd");
  if (report.languages.some((l) => (CODE_LANGUAGES as readonly string[]).includes(l))) {
    out.push("todo");
  }
  // Pure FS scan of src test files — applies once a scan target exists;
  // repos without test files would only get a vacuous row.
  if (hasTestFiles(root)) out.push("leaks");
  // Pure FS — no tool detection can make it inapplicable.
  out.push("scratchpad");
  return out;
}

/** Default max concurrent checks — bounds peak memory on big projects
 *  (tests, tsc, knip, jscpd each spawn their own heavy toolchain). */
export const DOCTOR_JOBS_DEFAULT = 1;

/** Assumed peak RSS per concurrent check worker (tests, tsc, knip, jscpd
 *  each spawn their own heavy toolchain, ~0.5-1 GB observed). */
export const DOCTOR_PER_WORKER_MEM_MB = 1024;

/**
 * Pure pool sizing: cap the requested job count by the memory budget.
 * `max(1, ...)` floors at one worker, so a starved box still runs checks
 * serially instead of refusing to run at all.
 */
export function effectiveJobs(
  opts: { jobs: number; availableMemMb: number; perWorkerMb?: number; },
): { jobs: number; clamped: boolean; } {
  const perWorkerMb = opts.perWorkerMb ?? DOCTOR_PER_WORKER_MEM_MB;
  const effective = Math.min(opts.jobs, Math.max(1, Math.floor(opts.availableMemMb / perWorkerMb)));
  return { jobs: effective, clamped: effective < opts.jobs };
}

export interface DoctorCheckOptions {
  /** Subset of checks to run. Undefined = all applicable. */
  checks?: CheckId[];
  /** Test command words override (defaults to settings.commands.test). */
  testCommand?: string;
  /** Max checks executing concurrently (integer >= 1; default 1). */
  jobs?: number;
  /** Available memory budget in MB. When set, the pool width is also capped
   *  by it (see effectiveJobs); absent = no memory cap. */
  availableMemMb?: number;
  /** Per-check subprocess budget in ms (integer >= 1; default
   *  CHECK_TIMEOUT_DEFAULT_MS). A check exceeding it is killed and reported
   *  as a check error. */
  timeoutMs?: number;
  /** Spawn injector (tests stub tools without subprocesses). */
  spawn?: SpawnFn;
  /** Run recorder; each completed check is recorded as an event so
   *  `giwt runs --json` shows per-check durationMs. Omitted in tests. */
  recorder?: RunRecorder;
  /** Scratchpad check inputs (settings-derived). When absent the check uses
   *  DEFAULT_SCRATCH_CONFIG / DEFAULT_SCRATCHPAD_THRESHOLDS and rootDir
   *  ".tmp". */
  scratch?: ScratchpadCheckOptions;
}

/**
 * Run the requested health checks against root. Throws on a nonexistent
 * root (matches detectProject) and on a `jobs` or `timeoutMs` value that
 * is not an integer >= 1; per-check failures — including a check whose
 * subprocess blew the timeout budget — are captured in the report, never
 * thrown.
 *
 * Checks execute through a bounded worker pool of at most `jobs`
 * concurrent tasks — the default (1) runs checks sequentially; raise it
 * ([doctor] jobs) when you want parallelism. When `availableMemMb` is
 * supplied the pool is additionally capped by that budget (see
 * effectiveJobs) and the applied sizing is
 * reported as `report.jobs`. The report preserves the requested check
 * order regardless of completion order.
 */
export async function runDoctorChecks(
  root: string,
  opts: DoctorCheckOptions = {},
  testCommand = "bun run test:unit",
): Promise<DoctorCheckReport> {
  const jobs = opts.jobs ?? DOCTOR_JOBS_DEFAULT;
  if (!Number.isInteger(jobs) || jobs < 1) {
    throw new Error(`doctor check: jobs must be an integer >= 1 (got ${jobs})`);
  }
  // Memory cap is computed at dispatch time (not module load) so a run sees
  // the box state it actually executes under.
  const sizing = opts.availableMemMb === undefined
    ? undefined
    : {
      ...effectiveJobs({ jobs, availableMemMb: opts.availableMemMb }),
      availableMemMb: opts.availableMemMb,
    };
  const poolWidth = sizing?.jobs ?? jobs;
  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_DEFAULT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`doctor check: timeoutMs must be an integer >= 1 (got ${timeoutMs})`);
  }
  const applicable = new Set(applicableChecks(root));
  const wanted = opts.checks ?? CHECK_IDS;
  const spawn = boundedSpawn(opts.spawn ?? defaultSpawn, timeoutMs);
  const ids = wanted.filter((id): id is CheckId => (CHECK_IDS as readonly string[]).includes(id));
  const checks: CheckResult[] = new Array(ids.length);
  const tasks: Array<{
    at: number;
    run: () => CheckResult | Promise<CheckResult>;
  }> = [];
  const skipped = (id: CheckId, tool: string, reason: string): CheckResult => ({
    id,
    tool,
    ok: true,
    skipped: reason,
    findings: [],
  });
  ids.forEach((id, at) => {
    if (!applicable.has(id)) {
      checks[at] = skipped(id, id, "not applicable to this project");
      return;
    }
    switch (id) {
      case "lint":
        tasks.push({ at, run: () => runLint(root, spawn) });
        break;
      case "typecheck":
        tasks.push({ at, run: () => runTypecheck(root, spawn) });
        break;
      case "tests":
        tasks.push({
          at,
          run: () => runTests(root, opts.testCommand ?? testCommand, spawn),
        });
        break;
      case "knip":
        tasks.push({ at, run: () => runKnip(root, spawn) });
        break;
      case "jscpd":
        tasks.push({ at, run: () => runJscpd(root, spawn) });
        break;
      case "todo":
        tasks.push({ at, run: () => runTodo(root) });
        break;
      case "leaks":
        tasks.push({ at, run: () => runLeaks(root) });
        break;
      case "scratchpad":
        tasks.push({
          at,
          run: () =>
            runScratchpad(
              join(root, opts.scratch?.rootDir ?? ".tmp"),
              opts.scratch?.config ?? DEFAULT_SCRATCH_CONFIG,
              opts.scratch?.thresholds ?? DEFAULT_SCRATCHPAD_THRESHOLDS,
            ),
        });
        break;
    }
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      const result = await task.run();
      checks[task.at] = result;
      // Record each check so `giwt runs --json` shows which gate was slow and
      // what it cost -- the reason durationMs exists. These are the slowest
      // steps in the tool (tsc, the test runner, knip), so they are the ones
      // worth timing. Concurrency means completion order, not check order.
      opts.recorder?.event(
        `check:${result.id}`,
        result.ok ? "ok" : "fail",
        result.error ?? result.skipped ?? `${result.findings.length} finding(s)`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(poolWidth, tasks.length) }, worker));
  return {
    version: 1,
    root,
    checks,
    ...(sizing
      ? {
        jobs: {
          requested: jobs,
          effective: sizing.jobs,
          availableMemMb: sizing.availableMemMb,
          clamped: sizing.clamped,
        },
      }
      : {}),
  };
}

/** Exit code for a report: 1 on any error finding or failed check. */
export function checkExitCode(report: DoctorCheckReport): number {
  for (const check of report.checks) {
    if (!check.ok && check.skipped === undefined) return 1;
    if (check.findings.some((f) => f.severity === "error")) return 1;
  }
  return 0;
}
