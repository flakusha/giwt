// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Backlog command — reconcile .plan/backlog/ index ↔ tier files.
 *
 * Subcommands:
 *   sync  Sync .plan/backlog/ index file maps ↔ tier files (--fix, --verbose)
 *
 * Pure I/O lives in src/plan/backlog-sync.ts; this handler owns arg
 * parsing, reporting, and exit codes. The handler throws on a missing
 * backlog dir (main() turns it into a friendly exit 1).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { applyFixes, BACKLOG_INDEX_FILES, reconcile } from "../plan/backlog-sync";
import { resolveFromRoot } from "../plan/validate";
import type { WorktreeConfig } from "../utils/config";
import { log, raw, section } from "../utils/output";

function usage(): void {
  raw("Usage: giwt backlog <subcommand> [flags]");
  raw("  sync  sync .plan/backlog/ index ↔ tier files (--fix, --verbose)");
}

export async function backlog(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === undefined || sub === "--help" || sub === "-h") {
    usage();
    process.exit(sub === undefined ? 1 : 0);
  }
  if (sub !== "sync") {
    log("error", `unknown backlog subcommand '${sub}'`);
    usage();
    process.exit(1);
  }

  const fix = rest.includes("--fix");
  const verbose = rest.includes("--verbose");
  const unknown = rest.filter(
    (a) => a !== "--fix" && a !== "--verbose" && a !== "--help" && a !== "-h",
  );
  if (unknown.length > 0 || rest.includes("--help") || rest.includes("-h")) {
    raw("Usage: giwt backlog sync [--fix] [--verbose]");
    raw("  Sync .plan/backlog/ index file maps ↔ tier files");
    raw("  --fix       apply automatic fixes (add orphans, drop phantoms)");
    raw("  --verbose   show per-file map state");
    process.exit(rest.includes("--help") || rest.includes("-h") ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const backlogDir = join(planDir, "backlog");
  const indexFiles = [...BACKLOG_INDEX_FILES];

  if (!existsSync(backlogDir)) {
    throw new Error(`${backlogDir}: missing backlog dir — nothing to sync`);
  }

  const result = reconcile(backlogDir, indexFiles);

  if (fix) {
    const fixReport = applyFixes(backlogDir, result);
    for (const line of fixReport.added) {
      log("info", line);
    }
    for (const line of fixReport.dropped) {
      log("info", line);
    }
    for (const line of fixReport.outside) {
      log("warn", line);
    }
    if (!fixReport.changed) {
      log("info", "Nothing to fix");
    } else {
      log("success", "Wrote index file(s). Re-run without --fix to verify.");
    }
    // Re-reconcile to show residual
    const residual = reconcile(backlogDir, indexFiles);
    if (residual.issueCount > 0) {
      log("warn", `${residual.issueCount} residual issue(s) after fix`);
    }
    process.exit(0);
  }

  // Report mode
  raw("");
  section("Reconcile .plan/backlog indexes");
  raw(`   Backlog .md files:   ${result.map.size + result.orphans.length}`);
  raw(`   Index files:         ${indexFiles.join(", ")}`);

  if (result.orphans.length > 0) {
    log("warn", `Orphans (not in any index file map): ${result.orphans.length}`);
    for (const f of result.orphans) {
      raw(`   ${f}`);
    }
  } else {
    log("info", "OK: No orphan files");
  }

  if (result.phantoms.length > 0) {
    log("warn", `Phantoms (index maps missing file): ${result.phantoms.length}`);
    for (const p of result.phantoms) {
      raw(`   ${p.index}:${p.row.line} -> ${p.row.file} (missing)`);
    }
  } else {
    log("info", "OK: No phantom entries");
  }

  if (result.outside.length > 0) {
    log("warn", `Non-backlog file-map targets: ${result.outside.length}`);
    for (const o of result.outside) {
      raw(`   ${o.index}:${o.row.line} -> ${o.row.target}`);
    }
  } else {
    log("info", "OK: No outside targets");
  }

  if (verbose) {
    raw("");
    section("File map state");
    for (const [file, rows] of [...result.map.entries()].sort()) {
      const homes = rows.map((r) => r.index).join(", ");
      const dup = rows.length > 1 ? " [warn] multiple homes" : "";
      raw(`   ${file.padEnd(28)} <- ${homes}${dup}`);
    }
    const listed = [...result.map.keys()].filter(
      (f) => !result.orphans.includes(f),
    );
    raw(
      `\n   Listed: ${listed.length} - Unlisted (orphans): ${result.orphans.length}`,
    );
  }

  if (result.issueCount === 0) {
    log("success", "Backlog indexes are in sync");
    process.exit(0);
  } else {
    log("warn", `${result.issueCount} actionable issue(s) found`);
    raw("Run with --fix to apply automatic fixes");
    process.exit(1);
  }
}
