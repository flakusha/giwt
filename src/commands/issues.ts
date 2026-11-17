// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";
import { emojiLine, parseIssueSearch } from "./search";

const CAP = 50;

const VALID_STATES: Record<string, true> = { open: true, closed: true, all: true };
// git-issue-ls documents exactly these three formats; anything else exits 1.
const VALID_FORMATS: Record<string, true> = { short: true, full: true, oneline: true };

interface IssueFlags {
  showAll: boolean;
  format: string;
  state: string | undefined;
}

function usage(): void {
  log(
    "error",
    "usage: giwt issues [--all|-a] [--state <open|closed|all>|-s <v>] [--format <short|full|oneline>|-f <f>] [--json|--toml|--emoji]",
  );
}

function fail(msg: string): never {
  log("error", msg);
  usage();
  process.exit(1);
}

function parseIssueFlags(rest: string[]): IssueFlags {
  let showAll = false;
  let format = "oneline";
  let state: string | undefined;
  const setFormat = (value: string): void => {
    if (!VALID_FORMATS[value]) fail(`invalid --format '${value}' (expected short|full|oneline)`);
    format = value;
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
          setFormat(value!);
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
          setFormat(arg.slice(arg.indexOf("=") + 1));
          break;
        }
        log("error", `unknown flag '${arg}'`);
        usage();
        process.exit(1);
      }
    }
  }
  return { showAll, format, state };
}

function issueLs(
  repoRoot: string,
  format: string,
  showAll: boolean,
  state: string | undefined,
): string {
  const gitArgs = ["issue", "ls", "--format", format];
  if (showAll) gitArgs.push("--all");
  // git-issue only accepts the space form: `--state=all` is an unknown option.
  if (state !== undefined) gitArgs.push("--state", state);
  try {
    return gitSync(repoRoot, ...gitArgs);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // gitSync surfaces git-issue's stderr in `detail`; when the CLI exits with
    // none, the generic failure still needs an actionable remedy.
    const hint = format === "full"
      ? "\ngit-issue can exit 1 with no stderr for --format full; try --all or --format oneline"
      : "";
    throw new Error(`${detail || `git ${gitArgs.join(" ")} failed`}${hint}`, { cause: error });
  }
}

function renderHumanIssues(output: string, showAll: boolean): void {
  const hits = parseIssueSearch(output);
  const lines = output.split("\n").filter(Boolean);

  if (hits.length === 0) {
    log("info", "no issues found");
    return;
  }

  if (!showAll && hits.length > CAP) {
    // Full format appends detail lines; keep them with their issue when capping.
    const kept: string[] = [];
    let seen = 0;
    for (const line of lines) {
      if (parseIssueSearch(line).length > 0) seen++;
      if (seen > CAP) break;
      kept.push(line);
    }
    log("info", `issues (${CAP} of ${hits.length}, ${hits.length - CAP} hidden — use --all):`);
    raw(kept.join("\n"));
    return;
  }

  log("info", `issues (${hits.length}):`);
  raw(lines.join("\n"));
}

export async function issues(args: string[], config: WorktreeConfig): Promise<void> {
  const { format: outFormat, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${outFormat}`);
  }

  const { showAll, format, state } = parseIssueFlags(rest);
  const output = issueLs(config.repoRoot, format, showAll, state);

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

  renderHumanIssues(output, showAll);
}
