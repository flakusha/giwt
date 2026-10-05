// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Agent commit command — GPG-signed commit from worktree
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { assertAuthorMatchesCommitter } from "../utils/author-guard";
import { branchToPath, type WorktreeConfig } from "../utils/config";
import { credentials } from "../utils/credentials";
import { gitSyncQuiet, isolatedGitEnv, isProtected, stagedDependencyPaths } from "../utils/git";
import { assertGpgUnlocked } from "../utils/gpg";
import { appendCommitOutcome } from "../utils/ledger";
import { extractMessageInput, validateMessage } from "../utils/message";
import { log, raw } from "../utils/output";

export async function commitWt(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const onProtected = args.includes("--on-protected");
  const noVerify = args.includes("--no-verify");
  const { rest, message: messageInput } = await extractMessageInput(
    args.filter((a) =>
      a !== "--on-protected" && a !== "--no-verify" && a !== "--allow-author-override"
    ),
  );
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

  // Protected branches have no worktree — a direct commit in the main
  // checkout requires an explicit --on-protected opt-in.
  let wtPath: string;
  if (isProtected(branch, config.settings.branches.protected)) {
    if (!onProtected) {
      log("error", `cannot commit-wt on protected branch '${branch}'`);
      raw("  Re-run with --on-protected to commit directly in the main checkout");
      process.exit(1);
    }
    const checkoutBranch = gitSyncQuiet(config.repoRoot, "branch", "--show-current");
    if (checkoutBranch !== branch) {
      log("error", `main checkout is on '${checkoutBranch ?? "(detached)"}', not '${branch}'`);
      raw(
        `  Next: check out '${branch}' in the main checkout first, or commit on the current branch instead.`,
      );
      process.exit(1);
    }
    log("warn", `direct commit on protected branch '${branch}' (--on-protected)`);
    wtPath = config.repoRoot;
  } else {
    if (onProtected) {
      log("error", `--on-protected given but '${branch}' is not a protected branch`);
      raw("  Next: drop --on-protected to commit in the worktree, or name a protected branch.");
      process.exit(1);
    }
    wtPath = resolve(config.treeDir, branchToPath(branch));
  }

  if (!existsSync(resolve(wtPath, ".git"))) {
    log("error", `worktree not found for branch '${branch}'`);
    raw(
      `  Next: create it with 'giwt new-branch ${branch} [base]', or check the spelling against 'giwt list'.`,
    );
    process.exit(1);
  }

  // Check staged changes — git diff --quiet exits 1 when differences exist
  const diffResult = Bun.spawnSync(
    ["git", "-C", wtPath, "diff", "--cached", "--quiet"],
    { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
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
    raw(
      "  Next: add AGENT_GPG_KEY_ID/NAME/EMAIL to .credentials.env (walked up from the repo root), then re-run.",
    );
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

  // Guard: refuse to commit when the repo-config author does not match the
  // maintainer identity from .credentials.env. GPG signing validates the
  // committer, not the author — a tampered repo config would silently
  // rewrite authorship while the signature stays valid. Compared against
  // config.agentGpgEmail (resolved from the repo being committed to), not
  // the import-time credentials module — same as commit.ts/merge.ts.
  assertAuthorMatchesCommitter({
    authorEmail,
    expectedEmail: config.agentGpgEmail ?? "",
    args,
    source: "commit",
  });

  // Verify GPG key is in the keyring AND unlocked. The helper exits 1 on
  // any of three failure modes with an actionable hint to gpg-unlock.
  assertGpgUnlocked(credentials.keyId);

  log("info", `Creating GPG-signed commit in '${branch}'...`);
  raw(`  Author:    ${authorName} <${authorEmail}>`);
  raw(`  Committer: ${credentials.name} <${credentials.email}>`);
  raw(`  GPG Key:   ${credentials.keyId.slice(0, 8)}...`);
  raw(`  Message:   ${message.split("\n")[0]}`);

  // Execute commit. By default the consuming repo's pre-commit hook runs
  // (git honours core.hooksPath itself); --no-verify is an explicit opt-out.
  // isolatedGitEnv() stripping GIT_*/harness vars does not starve the hook:
  // git generates its own hook-scoped environment when it invokes pre-commit.
  const commitArgs = [
    "git",
    "-C",
    wtPath,
    "-c",
    `user.signingkey=${credentials.keyId}`,
    "-c",
    "commit.gpgsign=true",
    "commit",
    "-S",
    ...(noVerify ? ["--no-verify"] : []),
    `--author=${authorName} <${authorEmail}>`,
    "-m",
    message,
  ];
  const result = Bun.spawnSync(commitArgs, {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...isolatedGitEnv(),
      GIT_COMMITTER_NAME: credentials.name,
      GIT_COMMITTER_EMAIL: credentials.email,
    },
  });

  if (result.exitCode !== 0) {
    log("error", `commit failed (exit ${result.exitCode})`);
    const stderrTail = String(result.stderr.toString()).replace(/\n$/, "");
    const lines = stderrTail.split("\n");
    log("error", lines.slice(-20).join("\n"));
    if (!noVerify) {
      raw("  Rejected by a commit hook? Re-run with --no-verify to skip it (explicit opt-in)");
    }
    process.exit(1);
  }

  // Verify signature
  const verify = Bun.spawnSync(
    ["git", "-C", wtPath, "log", "--show-signature", "-1"],
    { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
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
