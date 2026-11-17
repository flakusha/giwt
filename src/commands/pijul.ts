// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt pijul` — the safety-gated pijul passthrough. Every argv is classified
 * (src/pijul/policy.ts) before pijul runs; full stdout+stderr land in the run
 * record as pijul-output.txt. Exit code is pijul's, via process.exitCode.
 */

import { writeFileSync } from "node:fs";
import { classifyPijulInvocation } from "../pijul/policy";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";
import type { RunRecorder } from "../utils/runlog";

export async function pijulPassthrough(args: string[], config: WorktreeConfig): Promise<void> {
  const rest = args[0] === "--" ? args.slice(1) : args;
  const rec = activeRun();
  if (rest.length === 0) {
    log("error", "pijul: no arguments");
    raw("Usage: giwt pijul [--] <pijul args...>");
    rec?.event("pijul:gate", "blocked", "empty invocation");
    process.exitCode = 1;
    return;
  }

  const verdict = classifyPijulInvocation(rest, config.settings.pijul);
  if (verdict.verdict === "block") {
    log("error", `pijul blocked: ${verdict.reason}`);
    raw(`  refused: pijul ${rest.join(" ")}`);
    rec?.event(`pijul:${verdict.subcommand || "unknown"}`, "blocked", verdict.reason);
    process.exitCode = 1;
    return;
  }

  const proc = Bun.spawnSync(["pijul", ...rest], {
    cwd: config.worktreeRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: isolatedGitEnv(),
  });
  const exit = proc.exitCode ?? 0;
  const out = proc.stdout.toString();
  const err = proc.stderr.toString();

  captureOutput(rec, exit, out, err);
  rec?.event(
    `pijul:${verdict.subcommand}`,
    exit === 0 ? "ok" : "fail",
    `exit=${exit} stdout=${out.length}B stderr=${err.length}B`,
  );
  raw(out);
  if (err !== "") process.stderr.write(err);
  if (exit !== 0) process.exitCode = exit;
}

function captureOutput(rec: RunRecorder | null, exit: number, out: string, err: string): void {
  if (rec === null) return;
  try {
    writeFileSync(
      rec.capturePath("pijul-output.txt"),
      `# exit=${exit}\n# pijul stdout\n${out}# pijul stderr\n${err}`,
    );
  } catch { /* best-effort evidence */ }
}
