// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt jj` — the safety-gated jj passthrough. Every argv is classified
 * (src/jj/policy.ts) before jj runs; full stdout+stderr land in the run record
 * as jj-output.txt. Env vars that replace jj's config/identity wholesale are
 * refused before spawning (they bypass the classifier's config guards).
 */

import { writeFileSync } from "node:fs";
import { classifyJjInvocation } from "../jj/policy";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";
import type { RunRecorder } from "../utils/runlog";

const JJ_BYPASS_ENV = ["JJ_CONFIG", "JJ_USER", "JJ_EMAIL", "JJ_EDITOR"] as const;

export async function jjPassthrough(args: string[], config: WorktreeConfig): Promise<void> {
  const rest = args[0] === "--" ? args.slice(1) : args;
  const rec = activeRun();
  if (rest.length === 0) {
    log("error", "jj: no arguments");
    raw("Usage: giwt jj [--] <jj args...>");
    rec?.event("jj:gate", "blocked", "empty invocation");
    process.exitCode = 1;
    return;
  }

  for (const name of JJ_BYPASS_ENV) {
    if (process.env[name] === undefined) continue;
    log("error", `jj refused: ${name} is set — it bypasses jj's config/identity guards`);
    raw(`  refused: jj ${rest.join(" ")} (${name} set)`);
    rec?.event("jj:gate", "blocked", `${name} set`);
    process.exitCode = 1;
    return;
  }

  const verdict = classifyJjInvocation(rest, config.settings.jj);
  if (verdict.verdict === "block") {
    log("error", `jj blocked: ${verdict.reason}`);
    raw(`  refused: jj ${rest.join(" ")}`);
    rec?.event(`jj:${verdict.subcommand || "unknown"}`, "blocked", verdict.reason);
    process.exitCode = 1;
    return;
  }

  const proc = Bun.spawnSync(["jj", ...rest], {
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
    `jj:${verdict.subcommand}`,
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
      rec.capturePath("jj-output.txt"),
      `# exit=${exit}\n# jj stdout\n${out}# jj stderr\n${err}`,
    );
  } catch { /* best-effort evidence */ }
}
