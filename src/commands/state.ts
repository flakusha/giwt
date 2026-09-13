// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";
import { resolveExtid } from "./resolver";

export async function state(args: string[], config: WorktreeConfig): Promise<void> {
  const id = args[0];
  const targetState = args[1];

  if (!id || !targetState) {
    log("error", "issue ID and state required");
    raw("  Usage: state <ID> <open|closed>");
    process.exit(1);
  }

  const repoRoot = config.repoRoot;
  const resolved = resolveExtid(repoRoot, id);
  if (!resolved) {
    log("error", `issue not found: ${id}`);
    process.exit(1);
  }

  const flag = targetState === "open"
    ? "--open"
    : targetState === "closed"
    ? "--close"
    : `--state=${targetState}`;
  const output = gitSync(repoRoot, "issue", "state", resolved.hash, flag);
  raw(output);
}
