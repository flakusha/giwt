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

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyGitInvocation } from "../git/policy";
import { RTK_DISPLAY_SUBCOMMANDS } from "../git/policy-tables";
import { filterCoAuthorTrailers, loadAllowedTrailers } from "../utils/coauthors";
import { validateCommitMessageText } from "../utils/commit-message";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";
import type { RunRecorder } from "../utils/runlog";
import { scratchRoot } from "../utils/scratch-tmp";

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

  const policy = await applyTrailerPolicy(rest, verdict.subcommand, config, rec);
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

/** Best-effort removal of filtered -F throwaway temp files we created. */
function removeTempFiles(tempFiles: readonly string[]): void {
  for (const tempFile of tempFiles) {
    try {
      unlinkSync(tempFile);
    } catch { /* best-effort cleanup */ }
  }
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
 * Strip LLM Co-Authored-By trailers from -m/--message values (and -F
 * message files on commit); real co-authors are kept verbatim. The
 * commit-message hygiene gate (literal \n/\t, subject width) is validated
 * on the same values — a violation blocks the whole invocation.
 */
async function applyTrailerPolicy(
  args: readonly string[],
  subcommand: string,
  config: WorktreeConfig,
  rec: RunRecorder | null,
): Promise<{ args: string[]; violation: string | null; tempFiles: string[]; }> {
  if (subcommand !== "commit" && subcommand !== "merge") {
    return { args: [...args], violation: null, tempFiles: [] };
  }
  const allowed = loadAllowedTrailers(config.repoRoot);
  const out = [...args];
  // Temp files we ourselves created (rec === null path of filterMessageFile);
  // removed by gitPassthrough once git has read them. Runlog captures are
  // runlog-owned and never listed here.
  const tempFiles: string[] = [];
  let stripped = 0;
  let kept = 0;
  let violation: string | null = null;
  const filterText = (text: string): string | null => {
    const filtered = filterCoAuthorTrailers(text, allowed);
    stripped += filtered.stripped.length;
    kept += filtered.kept.length;
    const reason = validateCommitMessageText(filtered.message);
    if (reason !== null && violation === null) violation = reason;
    return filtered.stripped.length > 0 ? filtered.message : null;
  };
  for (let i = 0; i < out.length; i++) {
    const tok = out[i]!;
    if (tok === "-m" || tok === "--message") {
      const value = out[i + 1];
      if (value !== undefined) {
        const replacement = filterText(value);
        if (replacement !== null) out[i + 1] = replacement;
      }
    } else if ((tok.startsWith("-m") && tok.length > 2) || tok.startsWith("--message=")) {
      const prefix = tok.startsWith("--message=") ? "--message=" : "-m";
      const replacement = filterText(tok.slice(prefix.length));
      if (replacement !== null) out[i] = prefix + replacement;
    } else if (subcommand === "commit" && (tok === "-F" || tok === "--file")) {
      const path = out[i + 1];
      if (path !== undefined) {
        const replacement = await filterMessageFile(path, filterText, rec, tempFiles);
        if (replacement !== null) out[i + 1] = replacement;
      }
    } else if (subcommand === "commit" && (/^-F./.test(tok) || tok.startsWith("--file="))) {
      const path = tok.startsWith("--file=") ? tok.slice(7) : tok.slice(2);
      const replacement = await filterMessageFile(path, filterText, rec, tempFiles);
      if (replacement !== null) {
        out[i] = tok.startsWith("--file=") ? `--file=${replacement}` : `-F${replacement}`;
      }
    }
  }
  if (stripped > 0) {
    log("warn", `stripped ${stripped} LLM Co-Authored-By trailer(s) (${kept} kept)`);
    rec?.event(`git:${subcommand}`, "trailers", `stripped=${stripped} kept=${kept}`);
  }
  return { args: out, violation, tempFiles };
}

/**
 * Rewrite a -F message file with trailers stripped; returns the new path.
 * When no run recorder is active the filtered copy is a throwaway temp file
 * under $TMPDIR, recorded in `tempFiles` for gitPassthrough to unlink once
 * git has read it. Runlog captures (rec !== null) are runlog-owned and are
 * never tracked for removal.
 */
async function filterMessageFile(
  path: string,
  filterText: (text: string) => string | null,
  rec: RunRecorder | null,
  tempFiles: string[],
): Promise<string | null> {
  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch {
    return null; // unreadable — let git surface the real error
  }
  const replacement = filterText(content);
  if (replacement === null) return null;
  const newPath = rec !== null
    ? rec.capturePath("commit-msg-filtered.txt")
    : join(scratchRoot(), `giwt-git-msg-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(newPath, replacement);
  } catch {
    return null;
  }
  if (rec === null) tempFiles.push(newPath);
  return newPath;
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
