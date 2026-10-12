// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Report command — aggregate check-report status across worktrees.
 *
 * Reads both check-report schemas (see report-parse.ts) and renders one row
 * per worktree, or with `--profile` the cross-worktree gate failure profile
 * (report-profile.ts).
 */

import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { type WorktreeConfig } from "../utils/config";
import { type OutFormat, parseOutFlags } from "../utils/emit";
import { colorize, log, raw, section } from "../utils/output";
import { type NormalizedReport, parseReport } from "./report-parse";
import { printProfile, profileGates, type ProfileInput } from "./report-profile";

interface ReportOptions {
  profile: boolean;
  /** ISO timestamp, "" when --since was not given. */
  since: string;
  format: OutFormat;
}

type WalkRow =
  | { name: string; kind: "ok"; report: NormalizedReport; blank: boolean; }
  | { name: string; kind: "missing"; blank: boolean; }
  | { name: string; kind: "malformed"; error: string; blank: boolean; };

/** "advisory" and "timedOut" are outcomes the runner keeps distinct from a
 *  pass and from a red gate — collapsing them destroys the signal. */
function formatStatus(status: string): string {
  switch (status) {
    case "passed":
      return colorize("passed", "green");
    case "failed":
      return colorize("failed", "red");
    case "skipped":
      return colorize("skipped", "yellow");
    case "advisory":
      return colorize("advisory", "yellow");
    case "timedOut":
      return colorize("timedOut", "magenta");
    default:
      return colorize(`? ${status}`, "gray");
  }
}

function printHelp(): void {
  raw("Usage: giwt report [--profile] [--since <iso>] [--json|--toml|--emoji]");
  raw("  --profile       gate failure profile across every worktree's report");
  raw("  --since <iso>   only profile reports generated at/after this ISO timestamp");
  raw("  --json          machine-readable profile (--toml/--emoji also supported)");
}

function parseArgs(args: string[]): ReportOptions {
  const { format, rest } = parseOutFlags(args);
  const out: ReportOptions = { profile: false, since: "", format };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--profile") {
      out.profile = true;
    } else if (a === "--since") {
      const value = rest[++i];
      if (value === undefined || !Number.isFinite(Date.parse(value))) {
        log("error", `--since needs an ISO timestamp (got '${value ?? ""}')`);
        printHelp();
        process.exit(1);
      }
      out.since = value;
    } else {
      log("error", `unknown flag '${a}'`);
      printHelp();
      process.exit(1);
    }
  }
  if (out.format !== "human" && !out.profile) {
    log("warn", "output flags apply to --profile only — printing the listing");
  }
  return out;
}

async function readOne(name: string, path: string): Promise<WalkRow> {
  // Only the main row carries the trailing blank line; worktree rows never did.
  const blank = name === "(main)";
  if (!existsSync(path)) return { name, kind: "missing", blank };
  try {
    return { name, kind: "ok", report: parseReport(await readFile(path, "utf-8")), blank };
  } catch (error) {
    return {
      name,
      kind: "malformed",
      error: error instanceof Error ? error.message : String(error),
      blank,
    };
  }
}

/** One pass over (main + every worktree), in listing order. A missing or
 *  malformed report is a row, never an abort — one bad file never hides the
 *  rest of the tree. */
async function collectReports(
  config: WorktreeConfig,
): Promise<{ rows: WalkRow[]; treeMissing: boolean; }> {
  const rows: WalkRow[] = [
    await readOne("(main)", resolve(config.repoRoot, config.settings.paths.checkReport)),
  ];
  if (!existsSync(config.treeDir)) return { rows, treeMissing: true };
  const entries = await readdir(config.treeDir, { withFileTypes: true });
  for (const wt of entries.filter((e) => e.isDirectory())) {
    rows.push(
      await readOne(wt.name, resolve(config.treeDir, wt.name, config.settings.paths.checkReport)),
    );
  }
  return { rows, treeMissing: false };
}

function printRow(row: WalkRow): void {
  const label = `  ${colorize(row.name, "cyan")}`;
  if (row.kind === "missing") {
    raw(`${label} ${colorize("no report", "gray")}`);
    if (row.blank) raw("");
    return;
  }
  if (row.kind === "malformed") {
    raw(`${label} ${colorize("malformed report", "red")} — ${row.error}`);
    return;
  }
  const d = row.report;
  const overall = d.passed ? colorize("PASSED", "green") : colorize("FAILED", "red");
  raw(`${label} ${overall} — ${d.branch} @ ${d.gitHead}`);
  raw(`    run: ${d.runId} | mode: ${d.mode} | ${d.generatedAt}`);
  for (const gate of d.gates) {
    raw(`    ${gate.name}: ${formatStatus(gate.status)}`);
  }
  raw("");
}

/**
 * List check-report status for the main repo and every worktree, or with
 * `--profile` aggregate failing gates across every worktree's report.
 *
 * @param args CLI args (--profile, --since <iso>, output flags).
 * @param config Worktree configuration with repo root and tree dir.
 * @returns Resolves when the listing or profile is printed.
 */
export async function report(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const opts = parseArgs(args);
  const { rows, treeMissing } = await collectReports(config);

  if (opts.profile) {
    const inputs: ProfileInput[] = rows
      .filter((r): r is Extract<WalkRow, { kind: "ok"; }> => r.kind === "ok")
      .map((r) => ({ name: r.name, report: r.report }));
    printProfile(profileGates(inputs, opts.since || null), opts.format);
    return;
  }

  section("Check reports across worktrees");
  for (const row of rows) printRow(row);
  if (treeMissing) log("info", "No tree/ directory found");
}
