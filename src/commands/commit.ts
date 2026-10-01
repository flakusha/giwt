// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Commit command — GPG-signed commit on current branch
 */

import { type WorktreeConfig } from "../utils/config";
import {
  gitSync,
  gitSyncQuiet,
  isolatedGitEnv,
  isProtected,
  stagedDependencyPaths,
} from "../utils/git";
import { assertGpgUnlocked } from "../utils/gpg";
import { appendCommitOutcome } from "../utils/ledger";
import { extractMessageInput, validateMessage } from "../utils/message";
import { log, raw } from "../utils/output";
export async function commit(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const onProtected = args.includes("--on-protected");
  const { rest, message: messageInput } = await extractMessageInput(
    args.filter((a) => a !== "--on-protected"),
  );
  const message = messageInput ?? rest.join(" ");

  const validation = validateMessage(message);
  if (!validation.ok) {
    log("error", `commit message rejected: ${validation.reason}`);
    raw("  Usage: giwt commit [-F <file>|--message-file <file>] \"<type>(scope): <description>\"");
    raw("  Example: worktree commit -F - <<< \"fix(worktree): handle empty stdin\"");
    process.exit(1);
  }

  // Direct-commit guard: protected branches require an explicit opt-in.
  const currentBranch = gitSync(config.repoRoot, "branch", "--show-current") || "(detached)";
  if (isProtected(currentBranch, config.settings.branches.protected)) {
    if (!onProtected) {
      log("error", `refusing direct commit on protected branch '${currentBranch}'`);
      raw("  Re-run with --on-protected to commit directly (use worktrees for feature work)");
      process.exit(1);
    }
    log("warn", `direct commit on protected branch '${currentBranch}' (--on-protected)`);
  }

  // Verify agent credentials
  if (!config.agentGpgKeyId) {
    log("error", "AGENT_GPG_KEY_ID not set in .credentials.env");
    process.exit(1);
  }

  if (!config.agentGpgName || !config.agentGpgEmail) {
    log("error", "AGENT_GPG_NAME/AGENT_GPG_EMAIL not set in .credentials.env");
    process.exit(1);
  }

  // Check for staged changes
  const staged = Bun.spawnSync(
    ["git", "diff", "--cached", "--quiet"],
    { stdout: "pipe", stderr: "pipe", cwd: config.repoRoot, env: isolatedGitEnv() },
  );
  if (staged.exitCode === 0) {
    log("error", "no staged changes");
    raw("  Stage files first: git add <files>");
    process.exit(1);
  }

  // Guard: dependency directories must never be committed.
  const stagedDepPaths = stagedDependencyPaths(config.repoRoot);
  if (stagedDepPaths.length > 0) {
    log("error", `refusing to commit dependency directory: ${stagedDepPaths.join(", ")}`);
    raw("  Unstage with: git restore --staged <path>");
    process.exit(1);
  }

  // Get author from git config
  const authorName = gitSyncQuiet(config.repoRoot, "config", "user.name");
  const authorEmail = gitSyncQuiet(config.repoRoot, "config", "user.email");

  if (!authorName || !authorEmail) {
    log("error", "git user.name/user.email not configured");
    raw("  Run: git config user.name 'Your Name' && git config user.email 'you@example.com'");
    process.exit(1);
  }

  // Verify GPG key is in the keyring AND unlocked. The helper exits 1 on
  // any of three failure modes with an actionable hint to gpg-unlock.
  assertGpgUnlocked(config.agentGpgKeyId);

  log("info", `Creating GPG-signed commit on '${currentBranch}'...`);
  raw(`  Author:    ${authorName} <${authorEmail}>`);
  raw(`  Committer: ${config.agentGpgName} <${config.agentGpgEmail}>`);
  raw(`  GPG Key:   ${config.agentGpgKeyId.slice(0, 8)}...`);
  raw(`  Message:   ${message.split("\n")[0]}`);

  const result = Bun.spawnSync(
    [
      "git",
      "-C",
      config.repoRoot,
      "-c",
      `user.signingkey=${config.agentGpgKeyId}`,
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
        ...isolatedGitEnv(),
        GIT_COMMITTER_NAME: config.agentGpgName,
        GIT_COMMITTER_EMAIL: config.agentGpgEmail,
      },
    },
  );

  if (result.exitCode !== 0) {
    log("error", `commit failed (exit ${result.exitCode})`);
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  // Verify signature
  const commitSha = gitSync(config.repoRoot, "rev-parse", "HEAD");
  const verify = Bun.spawnSync(
    ["git", "-C", config.repoRoot, "verify-commit", commitSha],
    { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
  );

  if (verify.exitCode === 0) {
    log("success", `Commit created and GPG-signed: ${commitSha}`);
  } else {
    log("warn", "Commit created but signature verification failed");
  }
  // Outcome dispatch: the generic auto-append in index.ts recorded the
  // invocation; this records what landed (short SHA + subject).
  appendCommitOutcome(config.treeDir, "commit", currentBranch, commitSha, message);
}
