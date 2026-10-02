// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "path";
import type { WorktreeConfig } from "../../utils/config";
import { gitSyncQuiet } from "../../utils/git";
import { appendGripe } from "../../utils/ledger";
import { raw, section } from "../../utils/output";
import { activeRun } from "../../utils/runlog";

export function resolveDiffBase(wtPath: string, target: string): string {
  const mergeBase = gitSyncQuiet(wtPath, "merge-base", target, "HEAD").trim();
  if (mergeBase.length === 0) {
    throw new Error(
      `git merge-base ${target} HEAD failed — target is not a valid ref `
        + `or has no common ancestor with HEAD. Cannot determine diff-base `
        + `for 'bun run check --diff-base'.`,
    );
  }
  return mergeBase;
}

export function runCheck(
  wtPath: string,
  diffBase: string,
  extraCheckArgs: string[] = [],
  config?: WorktreeConfig,
  capturePath?: string,
): boolean {
  // The check command is user-configurable (settings.commands.check); the
  // diff-base flag is appended the same way the historical hard-coded
  // "bun run check" form was.
  const cmdWords = (config?.settings.commands.check ?? "bun run check").split(/\s+/);
  // --diff-base is opt-out (commands.diff_base = false): check runners that
  // don't consume it — e.g. a script ending in plain `bun test` — otherwise
  // interpret the sha as a test-file filter and fail. See ticket
  // FIX-gates-accepts-ambiguous-display-names.
  const diffBaseArgs = config?.settings.commands.diffBase === false
    ? []
    : ["--diff-base", diffBase];
  const result = Bun.spawnSync(
    [...cmdWords, ...diffBaseArgs, ...extraCheckArgs],
    { stdout: "pipe", stderr: "pipe", cwd: wtPath },
  );
  if (capturePath) {
    try {
      writeFileSync(capturePath, result.stdout.toString() + result.stderr.toString());
    } catch { /* best-effort */ }
  }
  if (result.exitCode !== 0) {
    // Surface the runner's stderr so the operator can see WHICH gate
    // failed (or why, e.g. an unknown --gates name). Without this, a
    // user passing --gates='lint - eslint' on a failing gate would
    // just see "Checks failed" with no actionable context.
    const stderr = result.stderr.toString();
    if (stderr.length > 0) {
      process.stderr.write(stderr);
    }
    reportCheckFailure(
      config ? resolve(wtPath, config.settings.paths.checkReport) : "",
      capturePath,
      result.stdout.toString(),
      config?.settings.output.streamTail ?? 25,
    );
  }
  return result.exitCode === 0;
}

/** Last N non-empty lines of `text`, printed via raw(). Used for bounded
 *  failure tails so a 1 MB test.log never floods the console. */
function printTail(text: string, lines: number): void {
  const parts = text.split("\n").filter((l) => l.length > 0);
  for (const line of parts.slice(Math.max(0, parts.length - lines))) {
    raw(`  ${line}`);
  }
}

// Failing gate names from the most recent check failure; surfaced in the
// failure gripe so the ledger line names the actual gates.
export let LAST_FAILED_GATES: string[] = [];

/**
 * Bounded on-console failure report for the check gate. Reads the
 * runner's check-report JSON when it exists and lists failing gate
 * names + first error line each (max 10); otherwise prints the last
 * lines of the runner's stdout. Always prints the artifact paths
 * (check.log capture + report) so the operator never hunts for them.
 * See ticket FIX-finalize-does-not-surface-gate-results-on-failure.
 */
export function reportCheckFailure(
  reportPath: string,
  capturePath: string | undefined,
  stdout: string,
  /** Cap for the stdout tail fallback — output.stream_tail, defaulted here for direct callers/tests. */
  streamTail = 25,
): void {
  LAST_FAILED_GATES = [];
  let failed: Array<{ name: string; first: string; }> = [];
  if (reportPath !== "" && existsSync(reportPath)) {
    try {
      // Two real-world runner shapes are accepted here:
      //   - giwt's own runner fixtures: checks[i].name
      //   - the loop-lore check runner (schemaVersion 1): checks[i].command
      //     ("bun run typecheck"), with output:null when a check was quiet.
      // BUG-finalize-check-failure-report-never-names-failed-gates-check:
      // filtering on `name` alone matched nothing on the real schema, so the
      // report degraded to a raw stdout tail and never named the failed gate.
      const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as {
        checks?: Array<{
          name?: string;
          command?: string;
          passed?: boolean;
          output?: string | null;
        }>;
      };
      for (const check of parsed.checks ?? []) {
        if (check.passed !== false) continue;
        const name = check.name ?? check.command;
        if (typeof name !== "string") continue;
        const first = (check.output ?? "").split("\n").find((l) => l.trim().length > 0) ?? "";
        failed.push({ name, first });
      }
    } catch { /* corrupt report — fall through to the stdout tail */ }
  }
  section("Failed checks");
  if (failed.length > 0) {
    LAST_FAILED_GATES = failed.map((f) => f.name);
    for (const f of failed.slice(0, 10)) {
      raw(`  ✗ ${f.name}`);
      if (f.first.length > 0) raw(`      ${f.first.slice(0, 200)}`);
    }
    if (failed.length > 10) raw(`  … and ${failed.length - 10} more`);
  } else {
    // A parseable report with no failing entry means the runner's own
    // accounting disagreed with the report (or it predates per-check
    // entries). Say so explicitly instead of letting raw runner stdout
    // masquerade as gate results under this heading.
    raw("  no failing gate found in the check report — showing the runner's stdout tail:");
    printTail(stdout, streamTail);
  }
  raw(`  Check log:    ${capturePath ?? "(not captured)"}`);
  if (reportPath !== "") raw(`  Check report: ${reportPath}`);
}

export function runTests(wtPath: string, config?: WorktreeConfig, capturePath?: string): boolean {
  const cmdWords = (config?.settings.commands.test ?? "bun run test:unit").split(/\s+/);
  const result = Bun.spawnSync(
    cmdWords,
    { stdout: "pipe", stderr: "pipe", cwd: wtPath },
  );
  if (capturePath) {
    try {
      writeFileSync(capturePath, result.stdout.toString() + result.stderr.toString());
    } catch { /* best-effort */ }
  }
  if (result.exitCode !== 0) {
    // Bounded on-console tail (output.stream_tail lines) mirroring the
    // check-gate report: which tests failed without dumping the 1 MB log.
    // The full output stays in the run-record capture; the step-3 branch
    // prints the "Full test log" pointer. See ticket
    // FEAT-bounded-output-mode-for-check-and-test-streams.
    section("Failed tests");
    printTail(
      result.stdout.toString() + "\n" + result.stderr.toString(),
      config?.settings.output.streamTail ?? 25,
    );
  }
  return result.exitCode === 0;
}

/**
 * Install the failure-gripe exit hook for one finalize run.
 *
 * Most finalize refusals exit via `process.exit(1)` deep inside
 * runFinalize, bypassing try/catch. The hook records a gripe for
 * exactly those paths; the thrown-error path records its own detailed
 * gripe (this hook is gone by then — uninstallSignalHandlers removes
 * all exit listeners). Only exit code 1 gripes: success (0) and signal
 * abort (130, covered by handleSignalAbort) stay quiet.
 * Best-effort: never throws (see appendLedger).
 *
 * Nested-finalize caveat: the `exit` event is process-wide, so an inner
 * run's `process.exit(1)` also fires an outer run's hook (one extra
 * gripe naming the outer branch). Only reachable from test fixtures —
 * real CLI runs never nest finalize.
 *
 * @param treeDir - shared tree directory holding the ledger
 * @param getBranch - reads the current branch hint at exit time
 */
export function installFailureGripe(treeDir: string, getBranch: () => string): void {
  const gripeOnFail = (): void => {
    if (process.exitCode !== 1) return;
    const branch = getBranch();
    const target = branch === "" ? "?" : branch;
    const runDir = activeRun()?.dir;
    const gates = LAST_FAILED_GATES.slice(0, 3).join(", ");
    const why = gates.length > 0 ? ` — failed gates: ${gates}` : "";
    const where = runDir ? ` — run record: ${runDir}` : "";
    appendGripe(treeDir, branch, `finalize ${target} failed (exit 1)${why}${where}`);
  };
  process.on("exit", gripeOnFail);
}
