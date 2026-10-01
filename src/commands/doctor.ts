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

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { dirname, join } from "node:path";
import {
  CHECK_IDS,
  checkExitCode,
  DOCTOR_PER_WORKER_MEM_MB,
  runDoctorChecks,
} from "../doctor/check.ts";
import type { CheckId } from "../doctor/check.ts";
import { detectProject } from "../doctor/detect.ts";
import { generateActionlint } from "../doctor/generators/actionlint.ts";
import { generateBiome } from "../doctor/generators/biome.ts";
import { generateCommitlint } from "../doctor/generators/commitlint.ts";
import { generateDependabot } from "../doctor/generators/dependabot.ts";
import { generateDprint } from "../doctor/generators/dprint.ts";
import { generateEditorconfig } from "../doctor/generators/editorconfig.ts";
import { generateEslint } from "../doctor/generators/eslint.ts";
import { generateGitignore } from "../doctor/generators/gitignore.ts";
import { generateHooks } from "../doctor/generators/hooks.ts";
import { generateJscpd } from "../doctor/generators/jscpd.ts";
import { generateKnip } from "../doctor/generators/knip.ts";
import { generateLefthook } from "../doctor/generators/lefthook.ts";
import { generateMadge } from "../doctor/generators/madge.ts";
import { generateMarkdownlint } from "../doctor/generators/markdownlint.ts";
import { generateOxlint } from "../doctor/generators/oxlint.ts";
import { generatePackageJson } from "../doctor/generators/package-json.ts";
import { generatePrettier } from "../doctor/generators/prettier.ts";
import { generateRenovate } from "../doctor/generators/renovate.ts";
import { recommend } from "../doctor/recommend.ts";
import type { DoctorOptions, GeneratedFile, ProjectReport, ToolId } from "../doctor/types.ts";
import type { WorktreeConfig } from "../utils/config.ts";
import { parseOutFlags, renderRecords } from "../utils/emit.ts";
import { gitSync, gitSyncQuiet } from "../utils/git.ts";
import { log, raw, section } from "../utils/output.ts";
import { activeRun } from "../utils/runlog.ts";

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

/**
 * `giwt doctor check` — run repo-health checks and report findings.
 *
 * Shares its check inventory with omp `/find-work` tool sources; `--json`
 * prints the machine-readable DoctorCheckReport (the cross-tool contract)
 * and nothing else on stdout. Uses process.exitCode (not process.exit) so
 * piped JSON is never truncated.
 */
/** ✅/❌/⚠️ per check ok/fail/warn + check id — one line per check. */
function doctorCheckEmoji(record: Record<string, unknown> | unknown): string {
  const rec = record as {
    id: string;
    ok: boolean;
    skipped?: string;
    findings: Array<{ severity: string; }>;
  };
  if (rec.skipped !== undefined) return `⏭️ ${rec.id} skipped`;
  const hasError = !rec.ok || rec.findings.some((f) => f.severity === "error");
  const mark = hasError ? "❌" : rec.findings.length > 0 ? "⚠️" : "✅";
  return `${mark} ${rec.id} (${rec.findings.length} finding(s))`;
}

async function runDoctorCheck(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  let root = config.worktreeRoot;
  let checks: CheckId[] | undefined;
  let jobs: number | undefined;
  let timeoutMs: number | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--root" || a.startsWith("--root=")) {
      const v = a.startsWith("--root=") ? a.slice(7) : rest[++i];
      if (v) root = v;
    } else if (a === "--checks" || a.startsWith("--checks=")) {
      const v = a.startsWith("--checks=") ? a.slice(9) : rest[++i];
      if (v) checks = v.split(",").map((s) => s.trim()).filter(Boolean) as CheckId[];
    } else if (a === "--jobs" || a.startsWith("--jobs=")) {
      const v = a.startsWith("--jobs=") ? a.slice(7) : rest[++i];
      if (v) jobs = Number(v);
    } else if (a === "--timeout" || a.startsWith("--timeout=")) {
      const v = a.startsWith("--timeout=") ? a.slice(10) : rest[++i];
      if (v) timeoutMs = Number(v);
    } else {
      log("error", `unknown flag '${a}'`);
      raw(
        "  Usage: giwt doctor check [--json|--toml|--emoji] [--checks <csv>] [--jobs <n>] [--timeout <ms>] [--root <dir>]",
      );
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
  if (jobs !== undefined && (!Number.isInteger(jobs) || jobs < 1)) {
    log("error", `--jobs must be an integer >= 1 (got ${jobs})`);
    process.exit(1);
  }
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
    log("error", `--timeout must be an integer >= 1 (got ${timeoutMs})`);
    process.exit(1);
  }
  // Per-check timings land in the run record, so `giwt runs --json` shows which
  // gate was slow and what it cost.
  const rec = activeRun();
  // Budget override beats the OS free-memory auto default; the cap itself is
  // applied inside runDoctorChecks at dispatch time.
  const budgetMb = config.settings.doctor.memoryBudgetMb;
  const availableMemMb = budgetMb > 0 ? budgetMb : Math.floor(freemem() / 2 ** 20);
  const report = await runDoctorChecks(
    root,
    {
      ...(checks ? { checks } : {}),
      jobs: jobs ?? config.settings.doctor.jobs,
      timeoutMs: timeoutMs ?? config.settings.doctor.timeoutMs,
      availableMemMb,
      ...(rec ? { recorder: rec } : {}),
      scratch: {
        config: config.settings.scratch,
        thresholds: {
          warnMb: config.settings.doctor.scratchpadWarnMb,
          errorMb: config.settings.doctor.scratchpadErrorMb,
          orphanWarn: config.settings.doctor.scratchpadOrphanWarn,
          oldestWarnDays: config.settings.doctor.scratchpadOldestWarnDays,
        },
        rootDir: config.settings.scratch.root,
      },
    },
    config.settings.commands.test,
  );
  // Low-memory clamp is reported, not silently swallowed. Every number comes
  // from the report — the applied sizing, not a local recomputation.
  if (report.jobs?.clamped) {
    log(
      "warn",
      `memory cap: doctor pool clamped ${report.jobs.requested} -> ${report.jobs.effective}`
        + ` (${report.jobs.availableMemMb} MB available, ${DOCTOR_PER_WORKER_MEM_MB} MB/worker)`,
    );
  }
  // Outcome summary on the run record: the same numbers the human report
  // and checkExitCode are built from, for `giwt runs` without opening files.
  const failedIds = report.checks
    .filter((c) =>
      (!c.ok && c.skipped === undefined) || c.findings.some((f) => f.severity === "error")
    )
    .map((c) => c.id);
  const skippedCount = report.checks.filter((c) => c.skipped !== undefined).length;
  const findingCount = report.checks.reduce((n, c) => n + c.findings.length, 0);
  const passedCount = report.checks.length - skippedCount - failedIds.length;
  activeRun()?.outcome({
    doctor: `${passedCount}/${report.checks.length} ok, ${failedIds.length} failed, `
      + `${skippedCount} skipped, ${findingCount} findings`,
    ...(failedIds.length > 0 ? { failedGates: failedIds } : {}),
  });
  if (format !== "human") {
    // json/toml carry the whole report contract; emoji maps one line per
    // check, so it renders the checks array instead.
    raw(
      format === "emoji"
        ? renderRecords(report.checks, format, { emoji: doctorCheckEmoji })
        : renderRecords(report, format, { emoji: doctorCheckEmoji }),
    );
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
    for (const note of check.notes ?? []) {
      raw(`       ${note}`);
    }
  }
  process.exitCode = checkExitCode(report);
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

  const isTs = report.languages.includes("typescript")
    || report.languages.includes("javascript");
  const hasAnyFormatter = report.existing.oxlint || report.existing.biome
    || report.existing.eslint || report.existing.dprint || report.existing.prettier;
  if (!report.existing.oxlint) accept("oxlint", generateOxlint(ctx));
  if (!report.existing.biome) accept("biome", generateBiome(ctx));
  if (!report.existing.knip) accept("knip", generateKnip(ctx));
  if (!report.existing.jscpd) accept("jscpd", generateJscpd(ctx));
  if (!report.existing.dprint) accept("dprint", generateDprint(ctx));
  if (!report.existing.markdownlint) accept("markdownlint", generateMarkdownlint(ctx));
  if (isTs && !hasAnyFormatter) accept("prettier", generatePrettier(ctx));
  if (isTs && !report.existing.madge) accept("madge", generateMadge(ctx));
  if (report.git.isGitRepo && !report.existing.renovate && !report.existing.dependabot) {
    accept("renovate", generateRenovate(ctx));
    accept("dependabot", generateDependabot(ctx));
  }
  if (report.git.isGitRepo && report.existing.workflows) {
    accept("actionlint", generateActionlint(ctx));
  }
  if (!report.existing.lefthook && opts.tools?.includes("lefthook")) {
    accept("lefthook", generateLefthook(ctx));
  }
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
