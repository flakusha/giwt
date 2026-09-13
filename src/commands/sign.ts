// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync } from "fs";
import { resolve } from "path";
import { branchToPath } from "../utils/config";
import { gitSync } from "../utils/git";
import { assertGpgUnlocked } from "../utils/gpg";
import { log, raw } from "../utils/output";

export async function execute(
  args: string[],
  config: Awaited<ReturnType<typeof import("../index").loadConfig>>,
): Promise<void> {
  const branch = args[0];
  if (!branch) {
    log("error", "branch name required");
    raw("  Usage: giwt sign <branch>");
    process.exit(1);
  }

  const dirName = branchToPath(branch);
  const wtPath = resolve(config.treeDir, dirName);

  if (!existsSync(resolve(wtPath, ".git"))) {
    log("error", `no worktree found for branch '${branch}'`);
    process.exit(1);
  }

  // Safety: never configure signing on main repo root
  const realWt = resolve(wtPath);
  const realRoot = resolve(config.repoRoot);
  if (realWt === realRoot) {
    log("error", "refusing to configure signing on main repo root");
    process.exit(1);
  }

  if (!config.agentGpgKeyId) {
    log("warn", "AGENT_GPG_KEY_ID not set — skipping signing config");
    return;
  }

  // Verify GPG key is configured AND unlocked. The helper exits 1 on
  // any of three failure modes (invalid-key, key-not-in-keyring,
  // key-not-unlocked) with an actionable hint to gpg-unlock.
  assertGpgUnlocked(config.agentGpgKeyId);

  log("info", "Configuring GPG signing for worktree...");

  gitSync(wtPath, "config", "commit.gpgsign", "true");
  gitSync(wtPath, "config", "user.signingkey", config.agentGpgKeyId);

  log("success", `GPG signing enabled (key: ${config.agentGpgKeyId.slice(0, 8)}...)`);

  // Configure hooks
  const hooksDir = resolve(config.repoRoot, ".githooks");
  if (existsSync(hooksDir)) {
    gitSync(wtPath, "config", "core.hooksPath", hooksDir);
    log("success", "hooks configured");
  }
}
