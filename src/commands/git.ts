// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt git` — the safety-gated git passthrough the agent harness reroutes
 * raw `git` invocations to. Every argv is classified (allowlist +
 * destructive/gpg-bypass guard, src/git/policy.ts) before git runs; full
 * stdout+stderr land in the run record as git-output.txt; commit/merge
 * messages get the LLM-Co-Authored-By strip (real co-authors kept); rtk
 * (when available, [git] rtk) prints compact output for read-only
 * subcommands. Exit code is git's, via process.exitCode.
 */

import { writeFileSync } from "node:fs";
import { classifyGitInvocation } from "../git/policy";
import { RTK_DISPLAY_SUBCOMMANDS } from "../git/policy-tables";
import { ALLOW_AUTHOR_OVERRIDE_FLAG, assertGitAuthorIdentity } from "../utils/author-guard";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";
import type { RunRecorder } from "../utils/runlog";
import { applyTrailerPolicy, removeTempFiles } from "./git-trailers";

/** Subcommands whose successful run creates or rewrites commits — these go
 * through the author-identity guard (see utils/author-guard.ts). */
const COMMIT_CLASS = new Set([
  "commit",
  "merge",
  "cherry-pick",
  "revert",
  "am",
  "rebase",
]);

export async function gitPassthrough(args: string[], config: WorktreeConfig): Promise<void> {
  const rest = args[0] === "--" ? args.slice(1) : args;
  const rec = activeRun();
  if (rest.length === 0) {
    log("error", "git: no arguments");
    raw("Usage: giwt git [--] <git args...>");
    rec?.event("git:gate", "blocked", "empty invocation");
    process.exitCode = 1;
    return;
  }
  const settings = config.settings.git;
  if (settings.classify !== "builtin") {
    log("error", `[git] classify '${settings.classify}' is not supported yet — only 'builtin'`);
    process.exitCode = 1;
    return;
  }
  if (!["auto", "on", "off"].includes(settings.rtk)) {
    log("warn", `[git] rtk '${settings.rtk}' invalid — using 'auto'`);
  }
  const rtkMode = ["auto", "on", "off"].includes(settings.rtk) ? settings.rtk : "auto";

  const verdict = classifyGitInvocation(rest, {
    safe: settings.safe,
    allow: settings.allow,
    deny: settings.deny,
  });
  if (verdict.verdict === "block") {
    log("error", `git blocked: ${verdict.reason}`);
    raw(`  refused: git ${rest.join(" ")}`);
    rec?.event(`git:${verdict.subcommand || "unknown"}`, "blocked", verdict.reason);
    process.exitCode = 1;
    return;
  }

  // Guard: commit-class subcommands author commits from the repo's config
  // identity (GPG signs the committer, not the author) — refuse a tampered
  // repo author unless explicitly overridden (see utils/author-guard). The
  // override flag is giwt's, not git's — strip it from the forwarded argv
  // (same convention as commit.ts/merge.ts).
  if (verdict.subcommand !== undefined && COMMIT_CLASS.has(verdict.subcommand)) {
    assertGitAuthorIdentity({
      cwd: config.worktreeRoot,
      expectedEmail: config.agentGpgEmail ?? "",
      args: rest,
      source: verdict.subcommand,
    });
  }
  const passArgs = verdict.subcommand !== undefined && COMMIT_CLASS.has(verdict.subcommand)
    ? rest.filter((a) => a !== ALLOW_AUTHOR_OVERRIDE_FLAG)
    : rest;

  const policy = await applyTrailerPolicy(passArgs, verdict.subcommand, config, rec);
  if (policy.violation !== null) {
    log("error", `git blocked: ${policy.violation}`);
    raw(`  refused: git ${rest.join(" ")}`);
    rec?.event(`git:${verdict.subcommand}`, "blocked", policy.violation);
    removeTempFiles(policy.tempFiles);
    process.exitCode = 1;
    return;
  }
  const execArgs = policy.args;
  const proc = Bun.spawnSync(["git", ...execArgs], {
    cwd: config.worktreeRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    // Strip harness-session context (GIT_/OMP_/PI_/...) so agent-invoked
    // git behaves exactly like a human shell's — same rationale as
    // gitSync's isolatedGitEnv (FIX: check verdicts diverging from a
    // human shell under agent env leakage).
    env: isolatedGitEnv(),
  });
  const exit = proc.exitCode ?? 0;
  const out = proc.stdout.toString();
  const err = proc.stderr.toString();
  // git has read any filtered -F temp files; remove them (best-effort —
  // runlog captures are intentionally left in place).
  removeTempFiles(policy.tempFiles);

  captureOutput(rec, exit, out, err);
  rec?.event(
    `git:${verdict.subcommand}`,
    exit === 0 ? "ok" : "fail",
    `exit=${exit} stdout=${out.length}B stderr=${err.length}B`,
  );
  writeConsole(rtkMode, verdict.subcommand, execArgs, config, out, err);
  // Non-zero only: dispatch already records 0 when the handler returns clean.
  if (exit !== 0) process.exitCode = exit;
}

/** Full raw evidence: one capture file with exit code, stdout, stderr. */
function captureOutput(rec: RunRecorder | null, exit: number, out: string, err: string): void {
  if (rec === null) return;
  try {
    writeFileSync(
      rec.capturePath("git-output.txt"),
      `# exit=${exit}\n# git stdout\n${out}# git stderr\n${err}`,
    );
  } catch { /* best-effort evidence */ }
}

/**
 * Console output: rtk compact form for read-only subcommands when rtk is
 * available; raw bytes otherwise. stderr always passes through verbatim.
 */
function writeConsole(
  rtkMode: string,
  subcommand: string,
  execArgs: readonly string[],
  config: WorktreeConfig,
  out: string,
  err: string,
): void {
  let printed = false;
  if (rtkMode !== "off" && RTK_DISPLAY_SUBCOMMANDS[subcommand]) {
    const rtkBin = Bun.which("rtk");
    if (rtkBin !== null) {
      const compact = Bun.spawnSync([rtkBin, "git", ...execArgs], {
        cwd: config.worktreeRoot,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      if (compact.exitCode === 0) {
        raw(compact.stdout.toString());
        printed = true;
      }
    } else if (rtkMode === "on") {
      log("warn", "[git] rtk=on but rtk not found on PATH — printing raw output");
    }
  }
  if (!printed) raw(out);
  // Byte-faithful relay: git's stderr stays on stderr (raw() is stdout-only).
  if (err !== "") process.stderr.write(err);
}
