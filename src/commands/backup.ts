// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup` — L0 dump lane: tar.zst archives with GNU listed-incremental
 * chains, sha256 sidecars, zstd integrity checks, replay verification, and
 * GFS rotation. Subcommands: `dump` (write; --dry-run previews the plan)
 * and `verify` (replay the youngest chain per target into the repo scratch
 * area). Engine modules live in src/backup/.
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type DumpOptions,
  type DumpPreviewRow,
  previewDump,
  type ResolvedTarget,
  runDump,
} from "../backup/dump";
import { safeTargetName } from "../backup/plan";
import { type BackupTool, verifyRoot } from "../backup/verify";
import { boundedSpawn, defaultSpawn } from "../doctor/check/spawn";
import type { WorktreeConfig } from "../utils/config";
import { log, outcomeLine, raw } from "../utils/output";
import { activeRun } from "../utils/runlog";
import { humanBytes } from "./clean";

const HELP = `backup <dump|verify> [targets...] [--dry-run]
  dump     tar.zst archive per target (weekly full + incremental .snar chain,
           sha256 sidecar, zstd -t after write, GFS rotation after verify)
  verify   replay the youngest full+increment chain per target into the
           repo scratch area and assert the tar table + manifest presence
  --dry-run   (dump only) print the plan without writing anything
  Targets default to [backup] targets (else the repo root); archives land
  under [backup] root (default .backups).`;

function usageError(message: string): never {
  throw new Error(`backup: ${message}\n${HELP}`);
}

function backupOptions(
  config: WorktreeConfig,
  rootAbs: string,
  targets: ResolvedTarget[],
): DumpOptions {
  const b = config.settings.backup;
  return {
    rootAbs,
    targets,
    keep: { keepDaily: b.keepDaily, keepWeekly: b.keepWeekly, keepMonthly: b.keepMonthly },
    timeoutMs: b.timeoutMs,
    sqliteAvailable: Bun.which("sqlite3") !== null,
    allowRootOwned: b.allowRootOwned,
    scratchRoot: join(config.worktreeRoot, config.settings.scratch.root),
  };
}

/** Validate + resolve target paths against the repo root. */
export function resolveTargets(config: WorktreeConfig, given: string[]): ResolvedTarget[] {
  const wanted = given.length > 0
    ? given
    : (config.settings.backup.targets.length > 0 ? config.settings.backup.targets : ["."]);
  return wanted.map((target) => {
    const targetAbs = resolve(config.repoRoot, target);
    if (!existsSync(targetAbs) || !statSync(targetAbs).isDirectory()) {
      throw new Error(`backup: target '${target}' is not a directory (resolved ${targetAbs})`);
    }
    return { target, targetAbs };
  });
}

function printPreview(rows: DumpPreviewRow[]): string {
  let fulls = 0;
  for (const row of rows) {
    if (row.level === "full") fulls++;
    raw(
      `   ${row.target}: ${row.level}`
        + (row.dbs > 0 ? `, ${row.dbs} sqlite snapshot(s)` : "")
        + (row.wouldPrune > 0 ? `, would prune ${row.wouldPrune} old archive(s)` : ""),
    );
  }
  return `dry-run: ${rows.length} target(s) planned (${fulls} full, ${
    rows.length - fulls
  } incremental)`;
}

function backupTool(timeoutMs: number): BackupTool {
  const bounded = boundedSpawn(defaultSpawn, timeoutMs);
  return async (cmd, cwd) => await bounded(cmd, cwd);
}

async function runDumpCommand(
  config: WorktreeConfig,
  rootAbs: string,
  targets: ResolvedTarget[],
): Promise<void> {
  try {
    const result = await runDump(backupOptions(config, rootAbs, targets));
    for (const d of result.dumps) {
      raw(
        `   ${d.target}: ${d.level} → ${d.archive} (${humanBytes(d.bytes)}, sha256 ${
          d.sha256.slice(0, 12)
        }…)`,
      );
    }
    for (const name of result.pruned) log("info", `rotated out: ${name}`);
    for (const skip of result.skippedDbs) {
      log("warn", `backup: DB NOT backed up — ${skip.file} (${skip.reason})`);
    }
    const summary = `dumped ${result.dumps.length} archive(s)`
      + (result.pruned.length > 0 ? `, pruned ${result.pruned.length}` : "");
    activeRun()?.outcome({ backup: summary });
    outcomeLine(true, summary);
  } catch (err) {
    log("error", (err as Error).message);
    activeRun()?.outcome({ backup: "dump failed" });
    outcomeLine(false, "dump failed");
    process.exitCode = 1;
  }
}

async function runVerifyCommand(
  config: WorktreeConfig,
  rootAbs: string,
  targets: ResolvedTarget[],
): Promise<void> {
  const verdicts = await verifyRoot({
    rootAbs,
    targets: targets.map((t) => safeTargetName(t.target)),
    tool: backupTool(config.settings.backup.timeoutMs),
    scratchRoot: join(config.worktreeRoot, config.settings.scratch.root),
  });
  let failed = 0;
  for (const v of verdicts) {
    if (v.ok) {
      raw(`   ${v.target}: ok — ${v.chain.length} archive(s) replayed, manifest present`);
    } else {
      failed++;
      raw(`   ${v.target}: FAIL — ${v.reason ?? "failed"}`);
    }
  }
  const summary = failed === 0
    ? `verified ${verdicts.length} chain(s)`
    : `verify failed for ${failed}/${verdicts.length} chain(s)`;
  activeRun()?.outcome({ backup: summary });
  if (failed > 0) process.exitCode = 1;
  outcomeLine(failed === 0, summary);
}

/** `giwt backup` entry: subcommand dispatch (dump | verify). */
export async function backup(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    raw(HELP);
    return;
  }
  const subcommand = args[0];
  if (subcommand !== "dump" && subcommand !== "verify") {
    usageError(
      subcommand === undefined
        ? "a subcommand is required (dump|verify)"
        : `unknown subcommand '${subcommand}'`,
    );
  }
  const rest = args.slice(1);
  const dryRun = rest.includes("--dry-run");
  const given = rest.filter((arg) => arg !== "--dry-run");
  if (dryRun && subcommand === "verify") {
    usageError("--dry-run applies to dump only (verify never writes)");
  }
  const rootAbs = resolve(config.repoRoot, config.settings.backup.root);
  const targets = resolveTargets(config, given);
  if (subcommand === "dump") {
    if (dryRun) {
      const summary = printPreview(previewDump(backupOptions(config, rootAbs, targets)));
      activeRun()?.outcome({ backup: summary });
      outcomeLine(true, summary);
      return;
    }
    return runDumpCommand(config, rootAbs, targets);
  }
  return runVerifyCommand(config, rootAbs, targets);
}
