// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { runLinkCheck } from "../../plan/check-links";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";

export async function runCheckLinks(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const unknown = args.filter(
    (a) => a !== "--help" && a !== "-h",
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan check-links");
    raw("  Validate internal markdown links + TASK refs");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = config.settings.paths.planDir;
  const scanDirs = ["docs", planDir];
  const ticketsDir = config.settings.paths.tickets;
  const result = runLinkCheck(
    config.worktreeRoot,
    scanDirs,
    ticketsDir,
    "src",
  );

  for (const b of result.broken) {
    log(
      "error",
      `${b.file}: broken link -> ${b.target} (resolved ${b.resolved})`,
    );
  }
  for (const o of result.orphanRefs) {
    log(
      "error",
      `${o.file}: orphan TASK ref ${o.ref} - line: ${o.line}`,
    );
  }
  for (const c of result.brokenComments) {
    log(
      "error",
      `${c.file}: broken comment citation -> ${c.path} (resolved ${c.resolved})`,
    );
  }

  const total = result.broken.length + result.orphanRefs.length
    + result.brokenComments.length;
  if (total > 0) {
    log("error", `${total} broken link(s)/ref(s) found`);
    process.exit(1);
  }
  log(
    "success",
    `OK - ${result.fileCount} markdown file(s), ${result.srcFileCount} source file(s); all internal links and comment citations resolve`,
  );
}
