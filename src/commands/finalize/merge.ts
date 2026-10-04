// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../../utils/config";
import { log } from "../../utils/output";

export function gpgMergeFlags(config: WorktreeConfig): string[] {
  if (!config.agentGpgKeyId) return [];
  const gpgCheck = Bun.spawnSync(
    ["gpg", "--list-secret-keys", config.agentGpgKeyId],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (gpgCheck.exitCode !== 0) return [];
  return [
    "-c",
    "commit.gpgsign=true",
    "-c",
    `user.signingkey=${config.agentGpgKeyId}`,
  ];
}

export function branchToSquashMessage(branch: string): string {
  let type = "chore";
  let subject = branch;

  const match = branch.match(/^(feature|fix|refactor|perf|docs|test|chore)\//);
  if (match) {
    const matched = match[1]!;
    type = matched === "feature" ? "feat" : matched;
    subject = branch.slice(match[0].length);
  }

  subject = subject.replace(/-/g, " ");
  subject = subject.charAt(0).toUpperCase() + subject.slice(1);

  return `${type}: ${subject}`;
}

/**
 * Parse the CLI args for `worktree finalize`.
 *
 * Returns a structured object that the finalize() entry point consumes.
 * Exported for unit testing — production callers in `finalize()` invoke it.
 *
 * Validation:
 * - Unknown merge strategy: error log + process.exit(1) (immediate abort).
 *   We can't return an error cleanly here because the CLI surface uses
 *   process.exit directly; tests should mock process.exit if they want
 *   to exercise this branch.
 * - --gates and --skip-gates are mutually exclusive: same exit semantics.
 *
 * The returned values are forward-compatible with the bun.run check
 * CLI: `--gates <csv>` / `--skip-gates <csv>` are passed through to
 * the runner which validates the names itself.
 */
export function parseFinalizeArgs(args: string[]): {
  branch: string;
  mergeStrategy: string;
  force: boolean;
  gatesFilter: string;
  skipGatesFilter: string;
  planGatesFilter: string;
  jobs: string;
  onto: string;
} {
  const nonFlagArgs: string[] = [];
  let mergeStrategy = "rebase";
  let force = false;
  let gatesFilter = "";
  let skipGatesFilter = "";
  let planGatesFilter = "";
  let jobs = "";
  let onto = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--merge-strategy") {
      const value = args[++i];
      if (value !== undefined) mergeStrategy = value;
    } else if (arg === "--onto") {
      onto = args[++i] || "";
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--gates") {
      gatesFilter = args[++i] || "";
    } else if (arg === "--skip-gates") {
      skipGatesFilter = args[++i] || "";
    } else if (arg === "--plan-gates") {
      planGatesFilter = args[++i] || "";
    } else if (arg === "--jobs") {
      // Check runners default their gate fan-out to 1 (serial) because
      // agents finalize worktrees concurrently and co-scheduled heavy gates
      // OOM the host. `--jobs N` is the explicit opt-in to a faster run.
      jobs = args[++i] || "";
    } else {
      nonFlagArgs.push(arg);
    }
  }
  if (gatesFilter && skipGatesFilter) {
    log("error", "--gates and --skip-gates are mutually exclusive");
    process.exit(1);
  }
  return {
    branch: nonFlagArgs[0] || "",
    mergeStrategy,
    force,
    gatesFilter,
    skipGatesFilter,
    planGatesFilter,
    jobs,
    onto,
  };
}
