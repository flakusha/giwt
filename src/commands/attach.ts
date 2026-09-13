// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { basename } from "path";
import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";
import { resolveExtid } from "./resolver";

export async function attach(args: string[], config: WorktreeConfig): Promise<void> {
  const id = args[0];
  const filePath = args[1];

  if (!id || !filePath) {
    log("error", "issue ID and file required");
    raw("  Usage: attach <ID> <FILE>");
    process.exit(1);
  }

  const fileExists = await Bun.file(filePath).exists();
  if (!fileExists) {
    log("error", `file not found: ${filePath}`);
    process.exit(1);
  }

  const repoRoot = config.repoRoot;
  const resolved = resolveExtid(repoRoot, id);
  if (!resolved) {
    log("error", `issue not found: ${id}`);
    process.exit(1);
  }

  const content = await Bun.file(filePath).text();
  const filename = basename(filePath);

  log("info", `attaching ${filename} to issue ${resolved.hash}`);
  const body = `## Attachment: ${filename}\n\n\`\`\`\n${content}\n\`\`\``;
  gitSync(repoRoot, "issue", "comment", resolved.hash, "-m", body);
  log("success", `attached ${filename}`);
}
