// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";
import { emojiLine, parseIssueSearch } from "./search";

const CAP = 50;

const VALID_STATES: Record<string, true> = { open: true, closed: true, all: true };

export async function issues(args: string[], config: WorktreeConfig): Promise<void> {
  const { format: outFormat, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${outFormat}`);
  }
  let showAll = false;
  let format = "oneline";
  let state: string | undefined;

  const usage = (): void => {
    log(
      "error",
      "usage: giwt issues [--all|-a] [--state <open|closed|all>|-s <v>] [--format <f>|-f <f>] [--json|--toml|--emoji]",
    );
  };
  const fail = (msg: string): never => {
    log("error", msg);
    usage();
    process.exit(1);
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
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
        const value = rest[++i];
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
  if (showAll) gitArgs.push("--all");
  // git-issue only accepts the space form: `--state=all` is an unknown option.
  if (state !== undefined) gitArgs.push("--state", state);
  const output = gitSync(repoRoot, ...gitArgs);

  if (outFormat !== "human") {
    const hits = parseIssueSearch(output);
    // TOML has no null: omit extid on issues whose title has no extid prefix.
    const records = outFormat === "toml"
      ? hits.map((h) =>
        h.extid === null
          ? { hash: h.hash, state: h.state, title: h.title }
          : h
      )
      : hits;
    raw(renderRecords(records, outFormat, { emoji: emojiLine }));
    return;
  }

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
