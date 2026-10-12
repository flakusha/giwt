// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt spdx-check` — SPDX license header guard.
 *
 * Reads REUSE.toml for per-directory rules, validates that each checked
 * file's SPDX-License-Identifier matches the rule for its path.
 *
 * Modes:
 *   default — scan whole tracked tree (warn-only)
 *   --staged — check only staged files
 *   <paths> — check exactly those files
 *   SPDX_CHECK=1 — blocking (exit 1 on violation)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import { checkHeader, parseReuseToml } from "../utils/reuse-toml";
import {
  getStagedFiles,
  getTrackedFiles,
  hasCheckableExtension,
  isExcluded,
} from "../utils/spdx-discovery";

const BLOCKING = process.env.SPDX_CHECK === "1";

export async function runSpdxCheck(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt spdx-check [--staged] [files...]");
    raw("  Validate SPDX headers against REUSE.toml rules");
    raw("  --staged  check only staged files");
    raw("  SPDX_CHECK=1  blocking mode (exit 1 on violation)");
    return;
  }

  const useStaged = args.includes("--staged");
  const explicitFiles = args.filter((a) => a !== "--staged");

  const reusePath = join(config.repoRoot, "REUSE.toml");
  let reuseContent: string;
  try {
    reuseContent = readFileSync(reusePath, "utf8");
  } catch {
    log("warn", `REUSE.toml not found at ${reusePath} — no rules to check`);
    return;
  }

  const rules = parseReuseToml(reuseContent);
  if (rules.length === 0) {
    log("warn", "REUSE.toml has no [[annotations]] blocks — nothing to check");
    return;
  }

  const files = explicitFiles.length > 0
    ? explicitFiles.filter(hasCheckableExtension).filter((f) => !isExcluded(f))
    : useStaged
    ? await getStagedFiles()
    : await getTrackedFiles();

  if (files.length === 0) {
    log("info", "no files to check");
    return;
  }

  const violations: { file: string; detail: string; }[] = [];
  for (const file of files) {
    const content = await Bun.file(join(config.repoRoot, file)).text();
    const rule = rules.find((r) => r.matchers.some((m) => m.test(file)));
    if (!rule) continue;
    const result = checkHeader(content, rule);
    if (!result.valid) {
      violations.push({
        file,
        detail: `license=${result.license ?? "missing"} (expected ${result.expectedLicense})`
          + ` copyright=${result.copyright ?? "missing"} (expected ${result.expectedCopyright})`,
      });
    }
  }

  if (violations.length === 0) {
    log("success", `all ${files.length} files have valid SPDX headers`);
    return;
  }

  for (const v of violations) raw(`  ${v.file}: ${v.detail}`);
  const msg = `${violations.length} file(s) with SPDX header violations`;
  if (BLOCKING) {
    log("error", msg);
    process.exit(1);
  }
  log("warn", msg);
}
