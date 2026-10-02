// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Git-hygiene detection for `giwt doctor`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../../utils/git";
import { unquote } from "./scan.ts";
import type { GitHygiene } from "./types.ts";

export function detectGitHygiene(root: string): GitHygiene {
  const gitDir = join(root, ".git");
  const isGitRepo = existsSync(gitDir);

  let hooksPath: string | null = null;
  if (isGitRepo) {
    const out = Bun.spawnSync(["git", "-C", root, "config", "core.hooksPath"], {
      stdout: "pipe",
      stderr: "pipe",
      env: isolatedGitEnv(),
    });
    if (out.exitCode === 0) {
      const value = out.stdout.toString().trim();
      if (value) hooksPath = value;
    }
  }

  const credPath = join(root, ".credentials.env");
  let agentEmail: string | null = null;
  if (existsSync(credPath)) {
    try {
      const content = readFileSync(credPath, "utf8");
      const match = content.match(/^\s*AGENT_GPG_EMAIL\s*=\s*(.+?)\s*$/m);
      if (match) agentEmail = unquote(match[1]!);
    } catch {
      agentEmail = null;
    }
  }

  let hasLinearHistoryConfig = false;
  if (isGitRepo) {
    const out = Bun.spawnSync(
      [
        "git",
        "-C",
        root,
        "config",
        "--get-regexp",
        "^(pull\\.ff|branch\\..*\\.rebase)$",
      ],
      { stdout: "pipe", stderr: "pipe", env: isolatedGitEnv() },
    );
    const stdout = out.stdout.toString();
    // `git config --get-regexp` prints "key value", unlike `--list` ("key=value").
    hasLinearHistoryConfig = /pull\.ff\s*=?\s*only/.test(stdout)
      || /branch\..+\.rebase\s*=?\s*true/.test(stdout);
  }

  return {
    isGitRepo,
    hooksPath,
    protectedBranches: readProtectedBranches(root),
    agentEmail,
    hasLinearHistoryConfig,
  };
}

function readProtectedBranches(root: string): string[] {
  const protectedSet: Record<string, true> = {
    master: true,
    main: true,
    stg: true,
    dev: true,
  };
  const prePush = join(root, ".githooks", "pre-push");
  if (existsSync(prePush)) {
    try {
      const content = readFileSync(prePush, "utf8");
      const match = content.match(/protected="([^"]+)"/);
      if (match) {
        for (const part of match[1]!.split("|")) {
          const stripped = part.replace(/[$()]/g, "");
          if (stripped) protectedSet[stripped] = true;
        }
      }
    } catch { /* keep defaults */ }
  }
  return Object.keys(protectedSet);
}
