#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * giwt — git worktree / commit / GPG / git-issue management CLI.
 *
 * Bun-only tooling: relies on Bun.spawnSync, Bun.file, and Bun test
 * throughout. If a node target ever lands, a shim layer is added first;
 * every env-specific call site lives under src/commands/ and src/utils/.
 *
 * Command dispatch is built on Optique: one `command()` parser per
 * subcommand with a greedy `passThrough()` tail, so each handler keeps
 * receiving its raw argument array (string[]) exactly as before the
 * Optique migration. Help/version/unknown-command handling, usage text,
 * and parse-error exit codes come from @optique/run's `run()`.
 *
 * All commands are registered here and delegated to ./commands/ modules.
 */

import { object, or } from "@optique/core/constructs";
import { text } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { command, constant, passThrough } from "@optique/core/primitives";
import { run } from "@optique/run";
import pkg from "../package.json" with { type: "json" };
import { type CommandHandler, commands } from "./cli-registry";
import { USAGE } from "./cli-usage";
import { isNoColor } from "./utils/colors";
import { loadConfig } from "./utils/config";
import { assertNotInWorktree, gitSyncQuiet } from "./utils/git";
import { appendLedger, extractSayArgs, LEDGER_SILENT_COMMANDS } from "./utils/ledger";
import { log, raw, setColorMode, setOutputFormat } from "./utils/output";
import { beginRun } from "./utils/runlog";

/**
 * One Optique subcommand per registered handler. The handler rides along
 * as a `constant()` and the greedy `passThrough()` captures every
 * remaining token verbatim, preserving the pre-Optique contract that
 * handlers own their argument parsing.
 */
function subcommand(name: string, def: CommandHandler) {
  return command(
    name,
    object({
      action: constant(def.run),
      args: withDefault(passThrough({ format: "greedy" }), [] as string[]),
    }),
    { description: [text(def.description)] },
  );
}

/** `or()` accepts at most 15 branches — nest groups for the full set. */
function buildParser() {
  const entries = Object.entries(commands).map(([name, def]) => subcommand(name, def));
  const groups: typeof entries[] = [];
  for (let i = 0; i < entries.length; i += 15) {
    groups.push(entries.slice(i, i + 15));
  }
  return or(...groups.map((group) => or(...group)));
}

/**
 * Commands that mutate worktree layout (create/remove/merge trees).
 * They must run from the main repo root — the guard is applied centrally
 * here so new commands cannot forget it. `finalize`/`agent-merge`/`rebase`
 * are the documented exemptions (they resolve the worktree from a branch
 * argument, so they are cwd-independent).
 */
const ROOT_ONLY_COMMANDS: Record<string, true> = {
  cleanup: true,
  create: true,
  merge: true,
  new: true,
  remove: true,
};

/** Detailed help for one command; body comes from USAGE when present. */
function printCommandHelp(name: string, def: CommandHandler): void {
  raw(`Usage: giwt ${name}${USAGE[name] ? ` ${USAGE[name].split("\n")[0]}` : " [[...]]"}`);
  raw(`  ${def.description}`);
  if (USAGE[name]) {
    raw(USAGE[name].split("\n").slice(1).join("\n"));
  }
  raw("Options: -h, --help  Show this help");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  // Preserve the pre-Optique contract: bare `giwt` shows help and exits 0.
  // Optique's `help` command provides the same output for `giwt help`.
  const args = argv.length === 0 ? ["help"] : argv;
  const cmdName = args[0]!;

  // `giwt help <cmd>` prints the command's real usage before Optique's
  // generic help parser sees it.
  if (cmdName === "help" && args.length > 1) {
    const target = commands[args[1]!];
    if (target) {
      printCommandHelp(args[1]!, target);
      return;
    }
  }

  // Parse errors, --help/--version, and `giwt help` exit inside run().
  const handler = await run(buildParser(), {
    programName: "giwt",
    version: pkg.version,
    description: [text("git worktree / commit / GPG / git-issue management CLI (bun-only)")],
    help: "both",
    args,
    colors: !isNoColor(),
  });

  // `giwt <cmd> --help` / `-h`: handlers own their flags via passthrough,
  // so intercept the help request here instead of feeding it to them.
  if (handler.args[0] === "--help" || handler.args[0] === "-h") {
    printCommandHelp(cmdName, commands[cmdName]!);
    return;
  }

  const config = await loadConfig();
  if (ROOT_ONLY_COMMANDS[cmdName]) {
    assertNotInWorktree(cmdName);
  }

  // Agent ledger: every run leaves one compact record (default message +
  // optional --say context). Say-flags are stripped before dispatch so
  // subcommands never see them.
  const { cleanArgs, said } = extractSayArgs(handler.args);
  // Logger format from settings ([output].format; env GIWT_OUTPUT wins at
  // module load). Applied before any command output, including run records.
  setOutputFormat(config.settings.output.format);
  // Color gate from settings ([output].color); GIWT_COLOR/NO_COLOR still
  // win per shouldColor precedence.
  setColorMode(config.settings.output.color);
  // An explicit --json/--toml/--emoji flag is the most specific
  // machine-output request: it forces a machine format so banners/log
  // traffic (including the run-record announcement) move to stderr and
  // stdout carries only the raw() payload. See
  // FIX-json-output-polluted-by-run-record-announcement.
  if (
    cleanArgs.includes("--json") || cleanArgs.includes("--toml")
    || cleanArgs.includes("--emoji")
  ) {
    setOutputFormat("json");
  }
  const silent = LEDGER_SILENT_COMMANDS[cmdName] === true;
  // Resolved branch: one `git branch --show-current` shared by both
  // evidence records. Never derived from args — a positional can be a
  // subcommand (`doctor check`) or absent (`sync`); "" on detached HEAD.
  // Silent commands record neither, so they skip the git call entirely.
  const branch = silent ? "" : gitSyncQuiet(config.worktreeRoot, "branch", "--show-current");
  // Run record first: the location is announced BEFORE the command runs,
  // and every later step can attach captures/events to it.
  const runRec = silent ? null : beginRun(config, cmdName, cleanArgs, said, branch);
  if (!silent) {
    appendLedger(config.treeDir, cmdName, cleanArgs, said, branch);
  }

  try {
    await handler.action(cleanArgs, config);
    // Handlers may set process.exitCode instead of exiting (doctor check
    // keeps piped JSON intact that way) — record the real code.
    runRec?.finish(typeof process.exitCode === "number" ? process.exitCode : 0);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", msg);
    runRec?.finish(1);
    process.exit(1);
  }
}

// Allow direct execution
if (import.meta.main) {
  await main();
}
