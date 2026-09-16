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
 *   giwt doctor check [--json]        run repo-health checks (lint, typecheck,
 *                                     tests, knip, jscpd, todo)
 *   giwt doctor --help                this help
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CHECK_IDS, checkExitCode, runDoctorChecks } from "../doctor/check.ts";
import type { CheckId } from "../doctor/check.ts";
import { detectProject } from "../doctor/detect.ts";
import { generateBiome } from "../doctor/generators/biome.ts";
import { generateCommitlint } from "../doctor/generators/commitlint.ts";
import { generateDprint } from "../doctor/generators/dprint.ts";
import { generateEditorconfig } from "../doctor/generators/editorconfig.ts";
import { generateEslint } from "../doctor/generators/eslint.ts";
import { generateGitignore } from "../doctor/generators/gitignore.ts";
import { generateHooks } from "../doctor/generators/hooks.ts";
import { generateJscpd } from "../doctor/generators/jscpd.ts";
import { generateKnip } from "../doctor/generators/knip.ts";
import { generateMarkdownlint } from "../doctor/generators/markdownlint.ts";
import { generateOxlint } from "../doctor/generators/oxlint.ts";
import { generatePackageJson } from "../doctor/generators/package-json.ts";
import { recommend } from "../doctor/recommend.ts";
import type { DoctorOptions, GeneratedFile, ProjectReport, ToolId } from "../doctor/types.ts";
import type { WorktreeConfig } from "../utils/config.ts";
import { gitSync, gitSyncQuiet } from "../utils/git.ts";
import { log, raw, section } from "../utils/output.ts";

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
    log("info", "Dry-run only — pass --apply to write these files");
    return;
  }

  section("doctor: apply");
  const written = writeAll(root, files);
  log("success", `Wrote ${written} file(s)`);

  // Apply git config side-effects (linear history, hooks path)
  applyGitConfig(report, root);
}

/**
 * `giwt doctor check` — run repo-health checks and report findings.
 *
 * Shares its check inventory with omp `/find-work` tool sources; `--json`
 * prints the machine-readable DoctorCheckReport (the cross-tool contract)
 * and nothing else on stdout. Uses process.exitCode (not process.exit) so
 * piped JSON is never truncated.
 */
async function runDoctorCheck(args: string[], config: WorktreeConfig): Promise<void> {
  let json = false;
  let root = config.worktreeRoot;
  let checks: CheckId[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") {
      json = true;
    } else if (a === "--root" || a.startsWith("--root=")) {
      const v = a.startsWith("--root=") ? a.slice(7) : args[++i];
      if (v) root = v;
    } else if (a === "--checks" || a.startsWith("--checks=")) {
      const v = a.startsWith("--checks=") ? a.slice(9) : args[++i];
      if (v) checks = v.split(",").map((s) => s.trim()).filter(Boolean) as CheckId[];
    } else if (a === "--help" || a === "-h") {
      raw("Usage: giwt doctor check [--json] [--checks <csv>] [--root <dir>]");
      raw("");
      raw("Run repo-health checks: lint, typecheck, tests, knip, jscpd, todo.");
      raw("Prints human-readable findings, or JSON with --json.");
      raw("Exit code is 1 on any error-severity finding or failed check.");
      return;
    } else {
      log("error", `unknown flag '${a}'`);
      raw("  Usage: giwt doctor check [--json] [--checks <csv>] [--root <dir>]");
      process.exit(1);
    }
  }
  if (checks) {
    const unknown = checks.filter((c) => !(CHECK_IDS as readonly string[]).includes(c));
    if (unknown.length > 0) {
      log("error", `unknown check id(s): ${unknown.join(", ")}`);
      raw(`  known: ${CHECK_IDS.join(", ")}`);
      process.exit(1);
    }
  }
  const report = runDoctorChecks(
    root,
    checks ? { checks } : {},
    config.settings.commands.test,
  );
  if (json) {
    raw(JSON.stringify(report, null, 2));
    process.exitCode = checkExitCode(report);
    return;
  }
  section("doctor: check");
  if (report.checks.length === 0) {
    log("info", "No applicable checks for this project");
    return;
  }
  for (const check of report.checks) {
    if (check.skipped) {
      raw(`   [=] ${check.id} — skipped (${check.skipped})`);
      continue;
    }
    if (!check.ok) {
      raw(`   [FAIL] ${check.id} (${check.tool}) — ${check.error ?? "failed"}`);
      continue;
    }
    const tag = check.findings.some((f) => f.severity === "error")
      ? "FAIL"
      : check.findings.length > 0
      ? "warn"
      : "ok";
    raw(`   [${tag}] ${check.id} (${check.tool}) — ${check.findings.length} finding(s)`);
    for (const f of check.findings) {
      raw(`       ${f.file}:${f.line} [${f.rule}] ${f.message}`);
    }
  }
  process.exitCode = checkExitCode(report);
}

function printHelp(): void {
  raw("Usage: giwt doctor [--apply] [--tool <csv>] [--root <dir>]");
  raw("       giwt doctor check [--json] [--checks <csv>] [--root <dir>]");
  raw("");
  raw("Detect project structure and set up dev tooling.");
  raw("Default mode is dry-run: shows what would be written.");
  raw("");
  raw("  --apply             write configs + apply git config (no --apply = dry-run)");
  raw("  --tool <csv>        restrict to specific tool ids (oxlint,knip,jscpd,...)");
  raw("  --root <dir>        override project root (default: worktreeRoot)");
  raw("  check               run repo-health checks instead of scaffolding:");
  raw("                        lint, typecheck, tests, knip, jscpd, todo");
  raw("  --json              (check only) machine-readable report on stdout");
  raw("  --checks <csv>      (check only) restrict to specific check ids");
  raw("  -h, --help          this help");
  raw("");
  raw("Tool ids: oxlint, eslint, biome, knip, jscpd, dprint, stylelint,");
  raw("          markuplint, markdownlint, commitlint, preCommit, postCommit,");
  raw("          prePush, linearHistory, pushProtection");
  raw("Check ids: lint, typecheck, tests, knip, jscpd, todo");
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
      raw("  Check subcommand: giwt doctor check [--json] [--checks <csv>] [--root <dir>]");
      process.exit(1);
    }
  }
  return out;
}

export function collectFiles(
  report: ProjectReport,
  opts: DoctorOptions,
  filter: Set<string> | null,
): GeneratedFile[] {
  const ctx = { report, options: opts };
  const out: GeneratedFile[] = [];
  const accept = (id: string, files: GeneratedFile[]): void => {
    if (filter && !filter.has(id)) return;
    out.push(...files);
  };

  if (!report.existing.oxlint) accept("oxlint", generateOxlint(ctx));
  if (!report.existing.biome) accept("biome", generateBiome(ctx));
  if (!report.existing.knip) accept("knip", generateKnip(ctx));
  if (!report.existing.jscpd) accept("jscpd", generateJscpd(ctx));
  if (!report.existing.dprint) accept("dprint", generateDprint(ctx));
  if (!report.existing.markdownlint) accept("markdownlint", generateMarkdownlint(ctx));
  if (!report.existing.eslint && opts.tools?.includes("eslint")) {
    accept("eslint", generateEslint(ctx));
  }
  accept("commitlint", generateCommitlint(ctx));
  if (!report.existing.preCommit || !report.existing.prePush) {
    accept("preCommit", generateHooks(ctx));
  }
  accept("gitignore", generateGitignore(ctx));
  accept("editorconfig", generateEditorconfig(ctx));
  accept("packageJson", generatePackageJson(ctx));

  return out;
}

export function writeAll(root: string, files: GeneratedFile[]): number {
  let n = 0;
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    if (f.merge && existsSync(abs)) {
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
      } catch (e) {
        log("warn", `merge skipped for ${f.path}: invalid JSON (${(e as Error).message})`);
        writeFileSync(abs, f.content);
        n++;
        raw(`   wrote ${f.path}`);
        continue;
      }
      const incoming = JSON.parse(f.content) as Record<string, unknown>;
      // ponytail: deep-merge ONLY for package.json `scripts` (user scripts
      // would otherwise be wiped by the doctor block). Top-level keys are
      // shallow-merged so existing fields like `name`/`type`/`dependencies`
      // are preserved; for arrays/primitives, incoming wins.
      const merged: Record<string, unknown> = { ...existing };
      for (const [k, v] of Object.entries(incoming)) {
        if (
          v && typeof v === "object" && !Array.isArray(v)
          && existing[k] && typeof existing[k] === "object"
          && !Array.isArray(existing[k])
          && f.path === "package.json" && k === "scripts"
        ) {
          merged[k] = {
            ...(existing[k] as Record<string, unknown>),
            ...(v as Record<string, unknown>),
          };
        } else {
          merged[k] = v;
        }
      }
      writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`);
    } else {
      writeFileSync(abs, f.content);
    }
    if (f.executable) {
      try {
        chmodSync(abs, 0o755);
      } catch { /* non-fatal on Windows */ }
    }
    raw(`   wrote ${f.path}`);
    n++;
  }
  return n;
}

function applyGitConfig(
  report: ProjectReport,
  root: string,
): void {
  if (!report.git.isGitRepo) return;

  // Linear history: pull.ff=only + branch.<current>.rebase=true
  if (!report.git.hasLinearHistoryConfig) {
    try {
      gitSync(root, "config", "pull.ff", "only");
      const cur = gitSyncQuiet(root, "branch", "--show-current");
      if (cur) gitSync(root, "config", `branch.${cur}.rebase`, "true");
      log("info", "git config: pull.ff=only + branch.<current>.rebase=true");
    } catch (e) {
      log("warn", `git config failed: ${(e as Error).message}`);
    }
  }

  // core.hooksPath: point at .githooks/ when hooks were written
  const hooksPath = join(root, ".githooks");
  if (existsSync(hooksPath)) {
    try {
      gitSync(root, "config", "core.hooksPath", ".githooks");
      log("info", "git config: core.hooksPath = .githooks");
    } catch (e) {
      log("warn", `git config core.hooksPath failed: ${(e as Error).message}`);
    }
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
