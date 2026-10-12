// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt spdx-fix` — apply SPDX headers to files that need them.
 *
 * Reads REUSE.toml for per-directory rules, applies (or replaces) SPDX
 * headers in-place. Preserves shebang lines and YAML frontmatter blocks.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { log } from "../utils/output";
import { parseReuseToml } from "../utils/reuse-toml";
import {
  getStagedFiles,
  getTrackedFiles,
  hasCheckableExtension,
  isExcluded,
} from "../utils/spdx-discovery";
import { fixFiles } from "../utils/spdx-fix";

export async function runSpdxFix(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    const { raw } = await import("../utils/output");
    raw("Usage: giwt spdx-fix [--staged] [files...]");
    raw("  Apply SPDX headers to files that need them");
    raw("  --staged  fix only staged files");
    return;
  }

  const useStaged = args.includes("--staged");
  const explicitFiles = args.filter((a) => a !== "--staged");

  const reusePath = join(config.repoRoot, "REUSE.toml");
  let reuseContent: string;
  try {
    reuseContent = readFileSync(reusePath, "utf8");
  } catch {
    log("error", `REUSE.toml not found at ${reusePath}`);
    process.exit(1);
  }

  const rules = parseReuseToml(reuseContent);
  if (rules.length === 0) {
    log("warn", "REUSE.toml has no [[annotations]] blocks — nothing to fix");
    return;
  }

  const files = explicitFiles.length > 0
    ? explicitFiles.filter(hasCheckableExtension).filter((f) => !isExcluded(f))
    : useStaged
    ? await getStagedFiles()
    : await getTrackedFiles();

  if (files.length === 0) {
    log("info", "no files to fix");
    return;
  }

  const fixed = await fixFiles(files.map((f) => join(config.repoRoot, f)), rules);
  log("success", `fixed ${fixed} file(s)`);
}
