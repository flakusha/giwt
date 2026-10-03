// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Sync command — sync ticket index with files + git issues.
 * Runs the internal sync implementation (src/tickets/sync-index.ts)
 * against the managed repo root, in-process.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildMap, writeMap } from "../plan/code-map";
import { genMatrix } from "../plan/feature-matrix";
import { resolveFromRoot } from "../plan/validate";
import { runSync, type SyncSummary } from "../tickets/sync-index";
import { type WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { log, raw, setOutputFormat } from "../utils/output";
import { activeRun } from "../utils/runlog";
import { mapSourcesFor } from "./plan";

export async function sync(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  const hasFix = rest.includes("--fix");
  const hasVerbose = rest.includes("--verbose");
  const hasImport = rest.includes("--import");
  const hasImportBack = rest.includes("--import-back");
  let diffBase = "";
  const knownFlags = new Set(["--fix", "--verbose", "--import", "--import-back", "--diff-base"]);
  const consumed = new Set<number>();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== "--diff-base") continue;
    if (i + 1 >= rest.length || rest[i + 1]!.startsWith("--")) {
      log("error", "--diff-base requires <ref>");
      raw(
        "  Usage: giwt sync [--fix] [--import] [--import-back] [--verbose] [--diff-base <ref>] [--json|--toml|--emoji]",
      );
      process.exit(1);
    }
    diffBase = rest[++i]!;
    consumed.add(i);
  }
  const unknown = rest.filter((a, i) => !consumed.has(i) && !knownFlags.has(a));
  if (unknown.length > 0) {
    log("error", `unknown flag '${unknown[0]}'`);
    raw(
      "  Usage: giwt sync [--fix] [--import] [--import-back] [--verbose] [--diff-base <ref>] [--json|--toml|--emoji]",
    );
    process.exit(1);
  }
  if ((hasImport || hasImportBack) && !hasFix) {
    log("error", "--import/--import-back require --fix");
    process.exit(1);
  }
  if (format !== "human") {
    // cli.ts only forces machine format for --json; --toml/--emoji must
    // route the progress log lines to stderr themselves so stdout carries
    // only the payload.
    setOutputFormat("json");
  }

  log("info", "Syncing ticket index...");
  let summary: SyncSummary | null = null;
  // Under machine formats runSync's own human report is administrative
  // traffic: live-forward it to stderr so stdout carries only the record
  // payload (same contract as the run-record announcement).
  const machine = format !== "human";
  const origWrite = process.stdout.write;
  if (machine) {
    process.stdout.write = ((chunk: unknown) => {
      process.stderr.write(chunk as never);
      return true;
    }) as never;
  }
  let exitCode: number;
  try {
    exitCode = runSync(config.worktreeRoot, {
      fix: hasFix,
      verbose: hasVerbose,
      import: hasImport,
      importBack: hasImportBack,
      ticketsPath: config.settings.paths.tickets,
      ...(diffBase ? { diffBase } : {}),
      onSummary: (s) => {
        summary = s;
      },
    });
  } finally {
    if (machine) process.stdout.write = origWrite;
  }
  if (summary !== null) {
    // Outcome lands on the run record BEFORE any exit path: the exit hook
    // backfills end/exitCode only, never outcome data.
    activeRun()?.outcome({ sync: summary });
  }
  // A --fix pass that changed plan state (index adoption, .md status
  // rewrites, import-back) leaves the generated plan artifacts stale — the
  // matrix and code-map freshness gates would fail on the very next
  // `plan validate`. Regenerate both when they exist so one command leaves
  // plan state consistent (BUG-sync-fix-leaves-feature-matrix-and-code-map-stale).
  // Missing artifacts are skipped: sync never invents generated files.
  // (Cast mirrors the machine-record path below: TS sees `summary` only
  // through the onSummary closure, so direct narrowing collapses to never.)
  const applied = summary as SyncSummary | null;
  if (hasFix && applied !== null && applied.fixesApplied > 0) {
    const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
    const matrixPath = join(planDir, "feature-matrix.md");
    if (existsSync(matrixPath)) {
      const { matrix } = genMatrix(join(planDir, "tickets", "index.json"), matrixPath);
      log("info", `regenerated ${matrixPath} (${matrix.total} tickets)`);
    }
    const mapPath = join(planDir, "code-map.json");
    if (existsSync(mapPath)) {
      writeMap(
        mapPath,
        buildMap(config.worktreeRoot, mapSourcesFor(config.settings.paths.planDir)),
      );
      log("info", `regenerated ${mapPath}`);
    }
  }
  if (format !== "human") {
    // Machine record = the sync counters (the run-record outcome payload);
    // a refused run (summary === null) prints an empty payload so stdout
    // still parses cleanly for empty inputs.
    const rec = summary as SyncSummary | null;
    raw(
      rec === null
        ? ""
        : renderRecords(rec, format, {
          emoji: (record) => {
            const s = record as SyncSummary;
            const mark = s.issuesRemaining > 0 ? "⚠️" : "✅";
            return `${mark} tickets: ${s.tickets} · fixes: ${s.fixesApplied}`
              + ` · issues: ${s.issuesRemaining} · advisory: ${s.advisoryRemaining}`;
          },
        }),
    );
  }
  if (exitCode !== 0) {
    log("error", `sync found actionable issues (exit ${exitCode})`);
    process.exit(exitCode);
  }
  if (format === "human") log("success", "Ticket index synced");
}
