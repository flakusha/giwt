// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";

export async function search(args: string[], config: WorktreeConfig): Promise<void> {
  const pattern = args[0];

  if (!pattern) {
    log("error", "search pattern required");
    raw("  Usage: search <pattern>");
    process.exit(1);
  }

  const repoRoot = config.repoRoot;
  log("info", `searching issues for: ${pattern}`);
  const output = gitSync(repoRoot, "issue", "search", pattern);
  raw(output || "no matches");
}
