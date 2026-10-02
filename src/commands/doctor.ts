// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Doctor command — detect project structure, recommend dev tooling,
 * optionally write configs; or run repo-health checks.
 *
 * Usage:
 *   giwt doctor                       detect + show plan (default dry-run)
 *   giwt doctor --apply               write configs + run `git config`
 *   giwt doctor --tool oxlint,knip    restrict to specific tools
 *   giwt doctor --root <dir>          operate on a different root
 *   giwt doctor check [--json|--toml|--emoji]        run repo-health checks (lint, typecheck,
 *                                     tests, knip, jscpd, todo, leaks, scratchpad)
 *   giwt doctor scratchpad [--json]   scratchpad bloat report (check shortcut)
 *   giwt doctor --help                this help
 */

import { detectProject } from "../doctor/detect.ts";
import { recommend } from "../doctor/recommend.ts";
import type { DoctorOptions, ToolId } from "../doctor/types.ts";
import type { WorktreeConfig } from "../utils/config.ts";
import { log, raw, section } from "../utils/output.ts";
import { activeRun } from "../utils/runlog.ts";
import { applyGitConfig, collectFiles, writeAll } from "./doctor/apply.ts";
import { runDoctorCheck } from "./doctor/check-cmd.ts";

export { collectFiles, writeAll } from "./doctor/apply.ts";

export async function doctor(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args[0] === "check") {
    await runDoctorCheck(args.slice(1), config);
    return;
  }

  if (args[0] === "scratchpad") {
    // Shorthand for the scratchpad check; extra flags (--json, --root,
    // --jobs) forward unchanged so check surface stays available.
    await runDoctorCheck(["--checks", "scratchpad", ...args.slice(1)], config);
    return;
  }

  const opts = parseArgs(args);
  const root = opts.root ?? config.worktreeRoot;
  if (root === config.worktreeRoot && config.worktreeRoot !== config.repoRoot) {
    log(
      "warn",
      `running inside a worktree — files will be written to ${config.worktreeRoot} (not the main repo ${config.repoRoot})`,
    );
  }

  section("doctor: detect");
  const report = detectProject(root);
  raw(`   root:           ${report.root}`);
  raw(`   languages:      ${report.languages.join(", ") || "(none detected)"}`);
  raw(`   packageManager: ${report.packageManager ?? "(none)"}`);
  raw(`   runtimes:       ${report.runtimes.join(", ") || "(none)"}`);
  raw(`   hasFrontend:    ${report.hasFrontend}`);
  raw(`   hasBackend:     ${report.hasBackend}`);
  raw(`   hasNative:      ${report.hasNative}`);
  raw(`   license:        ${report.license}`);
  raw(`   agentEmail:     ${report.git.agentEmail ?? "(none — push protection off)"}`);
  raw("");

  const rec = recommend(report);
  section("doctor: recommend");
  for (const r of rec.recommendations) {
    const marker = r.status === "add"
      ? "[+]"
      : r.status === "already-present"
      ? "[=]"
      : "[-]";
    raw(`   ${marker} ${pad(r.id, 16)} ${r.reason}`);
  }
  raw("");

  // Filter: only the requested tools (if --tool given)
  const toolFilter = opts.tools && opts.tools.length > 0
    ? new Set(opts.tools)
    : null;
  const files = collectFiles(report, opts, toolFilter);

  // Validate --tool ids against the union of all known recommendation ids
  // (recommendations + skipped). Unknown ids are an error, not a silent
  // no-op — otherwise typos like `--tool oxlin` would silently do nothing.
  if (opts.tools && opts.tools.length > 0) {
    const known = new Set<string>([
      ...rec.recommendations.map((r) => r.id),
      ...rec.skipped.map((r) => r.id),
    ]);
    const unknown = opts.tools.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      log("error", `unknown tool id(s): ${unknown.join(", ")}`);
      raw(" run `giwt doctor` without --tool to see all recommendations");
      process.exit(1);
    }
  }

  if (files.length === 0) {
    activeRun()?.outcome({ doctor: "nothing to do — all recommended tools configured" });
    log("success", "Nothing to do — all recommended tools already configured");
    return;
  }

  section("doctor: plan");
  for (const f of files) {
    const tag = f.merge ? "(merge)" : f.executable ? "(exec)" : "";
    raw(`   ${pad(f.path, 36)} ${tag}`);
  }
  raw("");

  if (opts.dryRun) {
    activeRun()?.outcome({ doctor: `dry-run: ${files.length} file(s) planned` });
    log("info", "Dry-run only — pass --apply to write these files");
    return;
  }

  section("doctor: apply");
  const written = writeAll(root, files);
  activeRun()?.outcome({ doctor: `applied: wrote ${written} file(s)` });
  log("success", `Wrote ${written} file(s)`);

  // Apply git config side-effects (linear history, hooks path)
  applyGitConfig(report, root);
}

function printHelp(): void {
  raw("Usage: giwt doctor [--apply] [--tool <csv>] [--root <dir>]");
  raw(
    "       giwt doctor check [--json|--toml|--emoji] [--checks <csv>] [--jobs <n>] [--timeout <ms>] [--root <dir>]",
  );
  raw("       giwt doctor scratchpad [--json] [--root <dir>]");
  raw("");
  raw("Detect project structure and set up dev tooling.");
  raw("Default mode is dry-run: shows what would be written.");
  raw("");
  raw("  --apply             write configs + apply git config (no --apply = dry-run)");
  raw("  --tool <csv>        restrict to specific tool ids (oxlint,knip,jscpd,...)");
  raw("  --root <dir>        override project root (default: worktreeRoot)");
  raw("  check               run repo-health checks instead of scaffolding:");
  raw("                        lint, typecheck, tests, knip, jscpd, todo, leaks, scratchpad");
  raw("  scratchpad          scratchpad bloat report — shortcut for `check --checks");
  raw("                        scratchpad`; shares --json/--root with check");
  raw("  --json              (check only) machine-readable report on stdout");
  raw("  --checks <csv>      (check only) restrict to specific check ids");
  raw("  --jobs <n>          (check only) max concurrent checks (default: [doctor] jobs, 1;");
  raw("                        pool also capped by memory, see [doctor] memory_budget_mb)");
  raw("  --timeout <ms>      (check only) per-check subprocess budget; a check that");
  raw("                        exceeds it is killed and reported (default:");
  raw("                        [doctor] timeout_ms, 120000)");
  raw("  -h, --help          this help");
  raw("");
  raw("Tool ids: oxlint, eslint, biome, knip, jscpd, dprint, stylelint,");
  raw("          markuplint, markdownlint, commitlint, preCommit, postCommit,");
  raw("          prePush, linearHistory, pushProtection, prettier, madge,");
  raw("          renovate, dependabot, actionlint, lefthook");
  raw("Check ids: lint, typecheck, tests, knip, jscpd, todo, scratchpad");
  raw("Check exit code is 1 on any error-severity finding or failed check.");
}

export function parseArgs(args: string[]): DoctorOptions {
  const out: DoctorOptions = { dryRun: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--apply") out.dryRun = false;
    else if (a === "--tool" || a.startsWith("--tool=")) {
      const v = a.startsWith("--tool=") ? a.slice(7) : args[++i];
      if (v) out.tools = v.split(",").map((s) => s.trim()).filter(Boolean) as ToolId[];
    } else if (a === "--root" || a.startsWith("--root=")) {
      const v = a.startsWith("--root=") ? a.slice(7) : args[++i];
      if (v) out.root = v;
    } else {
      // ponytail: explicit error rather than silent swallow — otherwise
      // misplaced subcommand tokens like `giwt doctor --tool oxlint check`
      // would silently run setup mode. Force the user to disambiguate.
      log("error", `unknown flag '${a}' for setup mode`);
      raw("  Setup flags: --apply, --tool <csv>, --root <dir>");
      raw(
        "  Check subcommand: giwt doctor check [--json|--toml|--emoji] [--checks <csv>] [--root <dir>]",
      );
      process.exit(1);
    }
  }
  return out;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
