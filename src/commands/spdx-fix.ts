// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt spdx-fix` — apply SPDX headers to files that need them.
 *
 * Reads REUSE.toml for per-directory rules, applies (or replaces) SPDX
 * headers in-place. Preserves shebang lines and YAML frontmatter blocks.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
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
    ? await getStagedFiles(config.repoRoot)
    : await getTrackedFiles(config.repoRoot);

  if (files.length === 0) {
    log("info", "no files to fix");
    return;
  }

  // Explicit args may be absolute or repo-relative; I/O uses the absolute
  // path either way (bare join would double an absolute arg).
  const absolute = files.map((f) => (isAbsolute(f) ? f : join(config.repoRoot, f)));
  const fixed = await fixFiles(absolute, rules, config.repoRoot);
  log("success", `fixed ${fixed} file(s)`);
}
