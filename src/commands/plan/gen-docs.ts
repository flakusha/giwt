// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectEpics, genDocs, generateIndex } from "../../plan/gen-docs";
import { resolveFromRoot } from "../../plan/validate";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";

export async function runGenDocs(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const isCheck = args.includes("--check");
  const unknown = args.filter(
    (a) => a !== "--help" && a !== "-h" && a !== "--check",
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan gen-docs [--check]");
    raw("  Generate .plan/epics-index.md from .plan/epics/epic-*.md files");
    raw("  --check  verify committed index matches fresh rebuild (CI gate)");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const epicsDir = join(planDir, "epics");
  const outPath = join(planDir, "epics-index.md");
  const backlogPath = join(planDir, "backlog", "open.md");

  if (isCheck) {
    if (!existsSync(outPath)) {
      log("error", "epics-index.md missing — run `giwt plan gen-docs` to generate");
      process.exit(1);
    }
    const epics = collectEpics(epicsDir);
    const fresh = generateIndex(epics, backlogPath);
    const committed = readFileSync(outPath, "utf8");
    if (fresh !== committed) {
      log("error", "epics-index.md is stale — run `giwt plan gen-docs` to regenerate");
      process.exit(1);
    }
    log("success", `OK - epics-index.md is up to date (${epics.length} epics)`);
    return;
  }

  const { epics } = genDocs(epicsDir, outPath, backlogPath);
  log("success", `wrote ${outPath} (${epics.length} epics)`);
}
