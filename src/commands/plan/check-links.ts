// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan check-links` — validate internal markdown links + TASK refs;
 * `--fix` rewrites broken link targets and orphan TASK refs in place
 * (unique-candidate repairs only), then re-scans.
 */

import { runLinkCheck } from "../../plan/check-links";
import { applyLinkFixes } from "../../plan/check-links/fix";
import type { WorktreeConfig } from "../../utils/config";
import { log, outcomeLine, raw } from "../../utils/output";

const USAGE = [
  "Usage: giwt plan check-links [--fix]",
  "  Validate internal markdown links + TASK refs",
  "  --fix   rewrite broken link targets and orphan TASK refs to their",
  "          resolved location (unique matches only), then re-scan",
];

export async function runCheckLinks(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const unknown = args.filter((a) => a !== "--help" && a !== "-h" && a !== "--fix");
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    for (const line of USAGE) raw(line);
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }
  const fix = args.includes("--fix");

  const planDir = config.settings.paths.planDir;
  const scanDirs = ["docs", planDir];
  const ticketsDir = config.settings.paths.tickets;

  const fixes = fix ? applyLinkFixes(config.worktreeRoot, scanDirs, ticketsDir, "src") : null;
  if (fixes !== null) {
    for (const f of fixes.fixed) {
      log(
        "info",
        f.kind === "link"
          ? `${f.file}: relinked ${f.from} -> ${f.to}`
          : `${f.file}: TASK ref ${f.from} -> ${f.to}`,
      );
    }
    for (const u of fixes.unfixableLinks) log("warn", `no unique repair target: ${u}`);
    for (const u of fixes.unfixableRefs) log("warn", `no unique ticket match: ${u}`);
    log("info", `${fixes.fixed.length} repair(s) applied`);
  }

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
  // One-line outcome contract: --fix mutates the repo, so it ends with
  // exactly one outcome line (repairs applied or what still stays broken).
  // Read-only runs (no --fix) keep their plain scan report.
  if (total > 0) {
    log("error", `${total} broken link(s)/ref(s) found`);
    if (fixes !== null) {
      outcomeLine(false, `${total} broken link(s)/ref(s) remain after fix`);
    }
    process.exit(1);
  }
  log(
    "success",
    `OK - ${result.fileCount} markdown file(s), ${result.srcFileCount} source file(s); all internal links and comment citations resolve`,
  );
  if (fixes !== null) {
    outcomeLine(true, `${fixes.fixed.length} repair(s) applied; links resolve`);
  }
}
