// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";
import { resolveExtid } from "./resolver";

export async function edit(args: string[], config: WorktreeConfig): Promise<void> {
  const id = args[0];
  const rest = args.slice(1);

  if (!id) {
    log("error", "issue ID required");
    raw("  Usage: edit <ID> [--label X] [--assignee X] [--priority X]");
    process.exit(1);
  }

  const repoRoot = config.repoRoot;
  const resolved = resolveExtid(repoRoot, id);
  if (!resolved) {
    log("error", `issue not found: ${id}`);
    process.exit(1);
  }

  const output = gitSync(repoRoot, "issue", "edit", resolved.hash, ...rest);
  raw(output);
}
