// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { branchToPath } from "../utils/config";
import { linkNodeModules } from "../utils/modules";
import { log, raw } from "../utils/output";

interface GhPr {
  headRefName: string;
  title: string;
  number: number;
}

export async function execute(
  _args: string[],
  config: Awaited<ReturnType<typeof import("../index").loadConfig>>,
): Promise<void> {
  // Check gh is installed
  const which = Bun.spawnSync(["which", "gh"], { stdout: "pipe", stderr: "pipe" });
  if (which.exitCode !== 0) {
    log("error", "GitHub CLI (gh) not installed — https://cli.github.com/");
    process.exit(1);
  }

  // Check gh is authenticated
  const auth = Bun.spawnSync(
    ["gh", "auth", "status"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (auth.exitCode !== 0) {
    log("error", "GitHub CLI not authenticated — run: gh auth login");
    process.exit(1);
  }

  log("info", "Fetching open PRs...");

  const result = Bun.spawnSync(
    ["gh", "pr", "list", "--json", "headRefName,title,number", "--limit", "100"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    log("error", "failed to fetch PRs");
    log("error", String(result.stderr.toString()).replace(/\n$/, ""));
    process.exit(1);
  }

  const prs: GhPr[] = JSON.parse(result.stdout.toString());
  if (prs.length === 0) {
    log("info", "No open PRs found");
    return;
  }

  raw(`  Found ${prs.length} open PR(s)`);
  raw("");

  mkdirSync(config.treeDir, { recursive: true });
  let created = 0;
  let skipped = 0;

  for (const pr of prs) {
    const dirName = branchToPath(pr.headRefName);
    const wtPath = resolve(config.treeDir, dirName);

    if (existsSync(wtPath)) {
      log("warn", `Skipped: ${pr.headRefName} (already exists)`);
      skipped++;
      continue;
    }

    log("info", `Creating worktree for PR #${pr.number}: ${pr.title}`);

    const addResult = Bun.spawnSync(
      ["git", "-C", config.repoRoot, "worktree", "add", wtPath, `origin/${pr.headRefName}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (addResult.exitCode === 0) {
      log("success", `Created: ${wtPath}`);

      linkNodeModules(config.repoRoot, wtPath);

      created++;
    } else {
      log("error", `Failed: ${pr.headRefName} (branch not found on remote)`);
    }
  }

  log("success", `Done: ${created} created, ${skipped} skipped`);
}
