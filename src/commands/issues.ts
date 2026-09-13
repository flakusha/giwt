// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";

export async function issues(args: string[], config: WorktreeConfig): Promise<void> {
  let showAll = false;
  let format = "oneline";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--all":
      case "-a":
        showAll = true;
        break;
      case "--format":
      case "-f": {
        const value = args[++i];
        if (value !== undefined) format = value;
        break;
      }
    }
  }

  const repoRoot = config.repoRoot;
  const output = gitSync(repoRoot, "issue", "ls", "--format", format);
  const lines = output.split("\n").filter(Boolean);

  if (lines.length === 0) {
    log("info", "no issues found");
    return;
  }

  log("info", `issues (${showAll ? lines.length : Math.min(lines.length, 50)}):`);
  const display = showAll ? lines : lines.slice(0, 50);
  raw(display.join("\n"));
}
