// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Agent commit command — GPG-signed commit from worktree
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { credentials } from "../utils/credentials";
import { gitSyncQuiet, isProtected, stagedDependencyPaths } from "../utils/git";
import { assertGpgUnlocked } from "../utils/gpg";
import { appendCommitOutcome } from "../utils/ledger";
import { extractMessageInput, validateMessage } from "../utils/message";
import { log, raw } from "../utils/output";

export async function commitWt(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { rest, message: messageInput } = await extractMessageInput(args);
  const [branch, ...messageParts] = rest;
  const message = messageInput ?? messageParts.join(" ");

  if (!branch) {
    log("error", "branch required");
    raw("  Usage: giwt commit-wt <branch> [-F <file>|--message-file <file>] \"<message>\"");
    process.exit(1);
  }

  const validation = validateMessage(message);
  if (!validation.ok) {
    log("error", `commit message rejected: ${validation.reason}`);
    raw("  Example: giwt commit-wt <branch> -F - <<< \"fix(worktree): handle empty stdin\"");
    process.exit(1);
  }

  if (isProtected(branch, config.settings.branches.protected)) {
    log("error", `cannot commit-wt on protected branch '${branch}'`);
    process.exit(1);
  }

  // Find worktree path from config
  const wtPath = resolve(config.treeDir, branchToPath(branch));

  if (!existsSync(resolve(wtPath, ".git"))) {
    log("error", `worktree not found for branch '${branch}'`);
    process.exit(1);
  }

  // Check staged changes — git diff --quiet exits 1 when differences exist
  const diffResult = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--cached", "--quiet"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (diffResult.exitCode === 0) {
    // Exit 0 = no staged changes
    log("error", `no staged changes in worktree '${branch}'`);
    raw(`  Stage files first: cd ${wtPath} && git add <files>`);
    process.exit(1);
  }

  // Guard: dependency directories must never be committed.
  const stagedDepPaths = stagedDependencyPaths(wtPath);
  if (stagedDepPaths.length > 0) {
    log("error", `refusing to commit dependency directory: ${stagedDepPaths.join(", ")}`);
    raw("  Unstage with: git restore --staged <path>");
    process.exit(1);
  }

  // Verify credentials
  if (!credentials.found) {
    log("error", "AGENT_GPG_KEY_ID/NAME/EMAIL not set — check .credentials.env");
    process.exit(1);
  }

  // Get author from worktree's local git config
  const authorName = gitSyncQuiet(wtPath, "config", "user.name");
  const authorEmail = gitSyncQuiet(wtPath, "config", "user.email");

  if (!authorName || !authorEmail) {
    log("error", "worktree user.name/user.email not configured");
    raw(`  Run: giwt sign ${branch}`);
    process.exit(1);
  }

  // Verify GPG key is in the keyring AND unlocked. The helper exits 1 on
  // any of three failure modes with an actionable hint to gpg-unlock.
  assertGpgUnlocked(credentials.keyId);

  log("info", `Creating GPG-signed commit in '${branch}'...`);
  raw(`  Author:    ${authorName} <${authorEmail}>`);
  raw(`  Committer: ${credentials.name} <${credentials.email}>`);
  raw(`  GPG Key:   ${credentials.keyId.slice(0, 8)}...`);
  raw(`  Message:   ${message.split("\n")[0]}`);

  // Execute commit
  const result = Bun.spawnSync(
    [
      "git",
      "-C",
      wtPath,
      "-c",
      `user.signingkey=${credentials.keyId}`,
      "-c",
      "commit.gpgsign=true",
      "commit",
      "-S",
      "--no-verify",
      `--author=${authorName} <${authorEmail}>`,
      "-m",
      message,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_COMMITTER_NAME: credentials.name,
        GIT_COMMITTER_EMAIL: credentials.email,
      },
    },
  );

  if (result.exitCode !== 0) {
    log("error", `commit failed (exit ${result.exitCode})`);
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  // Verify signature
  const verify = Bun.spawnSync(
    ["git", "-C", wtPath, "log", "--show-signature", "-1"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const output = verify.stdout.toString();

  if (output.includes("Good signature")) {
    raw(`\nCommit created:`);
    // Extract short hash from the first line
    const firstLine = output.split("\n")[0];
    raw(`  ${firstLine}`);
  } else {
    raw(`\nCommit created but signature verification unclear`);
    raw(output);
  }
  // Outcome dispatch: the generic auto-append in index.ts recorded the
  // invocation; this records what landed (short SHA + subject).
  const commitSha = gitSyncQuiet(wtPath, "rev-parse", "HEAD");
  appendCommitOutcome(config.treeDir, "commit-wt", branch, commitSha, message);
}
