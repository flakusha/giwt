// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";

const CAP = 50;

const VALID_STATES: Record<string, true> = { open: true, closed: true, all: true };

export async function issues(args: string[], config: WorktreeConfig): Promise<void> {
  let showAll = false;
  let format = "oneline";
  let state: string | undefined;

  const usage = (): void => {
    raw("  Usage: giwt issues [--all|-a] [--state <open|closed|all>|-s <v>] [--format <f>|-f <f>]");
  };
  const fail = (msg: string): never => {
    log("error", msg);
    usage();
    process.exit(1);
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--all":
      case "-a":
        showAll = true;
        break;
      case "--format":
      case "-f":
      case "--state":
      case "-s": {
        const isState = arg === "--state" || arg === "-s";
        const value = args[++i];
        if (value === undefined) fail(`missing value for '${arg}'`);
        if (isState) {
          if (!VALID_STATES[value!]) fail(`invalid --state '${value}' (expected open|closed|all)`);
          state = value;
        } else {
          format = value!;
        }
        break;
      }
      default: {
        if (arg.startsWith("--state=") || arg.startsWith("-s=")) {
          const value = arg.slice(arg.indexOf("=") + 1);
          if (!VALID_STATES[value]) fail(`invalid --state '${value}' (expected open|closed|all)`);
          state = value;
          break;
        }
        if (arg.startsWith("--format=") || arg.startsWith("-f=")) {
          format = arg.slice(arg.indexOf("=") + 1);
          break;
        }
        log("error", `unknown flag '${arg}'`);
        usage();
        process.exit(1);
      }
    }
  }

  const repoRoot = config.repoRoot;
  const gitArgs = ["issue", "ls", "--format", format];
  // git-issue only accepts the space form: `--state=all` is an unknown option.
  if (state !== undefined) gitArgs.push("--state", state);
  const output = gitSync(repoRoot, ...gitArgs);
  const lines = output.split("\n").filter(Boolean);

  if (lines.length === 0) {
    log("info", "no issues found");
    return;
  }

  if (!showAll && lines.length > CAP) {
    log("info", `issues (${CAP} of ${lines.length}, ${lines.length - CAP} hidden — use --all):`);
    raw(lines.slice(0, CAP).join("\n"));
    return;
  }

  log("info", `issues (${lines.length}):`);
  raw(lines.join("\n"));
}
