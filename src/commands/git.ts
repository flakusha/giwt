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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyGitInvocation } from "../git/policy";
import { RTK_DISPLAY_SUBCOMMANDS } from "../git/policy-tables";
import { filterCoAuthorTrailers, loadAllowedTrailers } from "../utils/coauthors";
import type { WorktreeConfig } from "../utils/config";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";
import type { RunRecorder } from "../utils/runlog";

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

  const execArgs = await applyTrailerPolicy(rest, verdict.subcommand, config, rec);
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
 * Strip LLM Co-Authored-By trailers from -m/--message values (and -F
 * message files on commit); real co-authors are kept verbatim.
 */
async function applyTrailerPolicy(
  args: readonly string[],
  subcommand: string,
  config: WorktreeConfig,
  rec: RunRecorder | null,
): Promise<string[]> {
  if (subcommand !== "commit" && subcommand !== "merge") return [...args];
  const allowed = loadAllowedTrailers(config.repoRoot);
  const out = [...args];
  let stripped = 0;
  let kept = 0;
  const filterText = (text: string): string | null => {
    const filtered = filterCoAuthorTrailers(text, allowed);
    stripped += filtered.stripped.length;
    kept += filtered.kept.length;
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
        const replacement = await filterMessageFile(path, filterText, rec);
        if (replacement !== null) out[i + 1] = replacement;
      }
    } else if (subcommand === "commit" && (/^-F./.test(tok) || tok.startsWith("--file="))) {
      const path = tok.startsWith("--file=") ? tok.slice(7) : tok.slice(2);
      const replacement = await filterMessageFile(path, filterText, rec);
      if (replacement !== null) {
        out[i] = tok.startsWith("--file=") ? `--file=${replacement}` : `-F${replacement}`;
      }
    }
  }
  if (stripped > 0) {
    log("warn", `stripped ${stripped} LLM Co-Authored-By trailer(s) (${kept} kept)`);
    rec?.event(`git:${subcommand}`, "trailers", `stripped=${stripped} kept=${kept}`);
  }
  return out;
}

/** Rewrite a -F message file with trailers stripped; returns the new path. */
async function filterMessageFile(
  path: string,
  filterText: (text: string) => string | null,
  rec: RunRecorder | null,
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
    : join(tmpdir(), `giwt-git-msg-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(newPath, replacement);
  } catch {
    return null;
  }
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
