// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { readdirSync, statSync } from "fs";
import { join } from "path";
import type { WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import { attach } from "./attach";

export async function attachDir(args: string[], config: WorktreeConfig): Promise<void> {
  const id = args[0];
  const dirPath = args[1];

  if (!id || !dirPath) {
    log("error", "issue ID and directory required");
    raw("  Usage: attach-dir <ID> <DIR>");
    process.exit(1);
  }

  if (!statSync(dirPath, { throwIfNoEntry: false })?.isDirectory()) {
    log("error", `directory not found: ${dirPath}`);
    process.exit(1);
  }

  log("info", `attaching files from ${dirPath} to issue ${id}`);
  let count = 0;

  for (const name of readdirSync(dirPath)) {
    const fp = join(dirPath, name);
    if (!statSync(fp).isFile()) continue;
    await attach([id, fp], config);
    count++;
  }

  log("success", `attached ${count} files`);
}
