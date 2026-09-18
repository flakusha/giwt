// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { raw } from "../utils/output";

/**
 * Subcommand surface of the git-issue CLI, verified against the installed
 * git-issue 1.3.3 (`git issue --help`): there is no close command, and the
 * issue-taking subcommands want the issue id first (show/edit/state <id>).
 * Mirrored here so a failed passthrough can print the real usage and the
 * close remedy instead of only the wrapper's rejection fragment (ticket
 * FIX-gi-passthrough-contract).
 */
const GIT_ISSUE_COMMANDS =
  "create ls show comment edit state import export sync merge fsck init version";

export async function gi(args: string[], config: WorktreeConfig): Promise<void> {
  const forwarded = ["git", "issue", ...args].join(" ");
  let output: string;
  try {
    output = gitSync(config.repoRoot, "issue", ...args);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${forwarded} failed: ${detail}\n`
        + `usage: git issue <command> [<args>] with command: ${GIT_ISSUE_COMMANDS}\n`
        + `git-issue has no close command; to close an issue run: giwt gi state <issue-id> --close`,
      { cause: error },
    );
  }
  raw(output);
}
