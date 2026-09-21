// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Plan command — subcommand dispatcher for .plan/ tooling.
 *
 * Subcommands:
 *   backlog-sync  Sync .plan/backlog/ index file maps ↔ tier files (--fix, --verbose)
 *   code-map      Build/check/query reverse code→plan index (--check, --find <path>)
 *   gen-docs      Generate .plan/epics-index.md from .plan/epics/
 *   matrix        Generate .plan/feature-matrix.md from the ticket index
 *   check-links   Validate internal markdown links + TASK refs
 *   validate      Comprehensive .plan/ validation (--gates <list>)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFixes, reconcile } from "../plan/backlog-sync";
import { runLinkCheck } from "../plan/check-links";
import { buildMap, findOwners, findStale, readMap, verifyFresh, writeMap } from "../plan/code-map";
import { genMatrix, matrixOutput } from "../plan/feature-matrix";
import { collectEpics, genDocs, generateIndex } from "../plan/gen-docs";
import { ALL_GATES, renderValidateSummary, resolveFromRoot, runValidate } from "../plan/validate";
import { runSync } from "../tickets/sync-index";
import { type WorktreeConfig } from "../utils/config";
import { log, raw, section } from "../utils/output";

/** Structured subcommand metadata — drives help text + validation. */
interface SubcommandInfo {
  name: string;
  description: string;
  flags: string;
}

const SUBCOMMAND_INFO: SubcommandInfo[] = [
  {
    name: "backlog-sync",
    description: "Sync .plan/backlog/ index ↔ tier files",
    flags: "--fix, --verbose",
  },
  {
    name: "code-map",
    description: "Build/check/query reverse code→plan index",
    flags: "--check, --find <path>, --stale",
  },
  { name: "gen-docs", description: "Generate .plan/epics-index.md from epics", flags: "--check" },
  {
    name: "matrix",
    description: "Generate feature matrix from ticket index",
    flags: "--check, --json, --cooccurrence",
  },
  { name: "check-links", description: "Validate internal markdown links + TASK refs", flags: "" },
  {
    name: "validate",
    description: "Comprehensive .plan/ validation",
    flags: "--gates <csv>, --skip-gates <csv>, --fix, --json",
  },
  { name: "status", description: "Show .plan/ health summary", flags: "" },
];

const SUBCOMMANDS = SUBCOMMAND_INFO.map((s) => s.name) as readonly string[];
type Subcommand = (typeof SUBCOMMANDS)[number];

/** Generate aligned help text from structured subcommand metadata. */
function formatSubcommandHelp(): string[] {
  const maxName = Math.max(...SUBCOMMAND_INFO.map((s) => s.name.length));
  const lines: string[] = ["Usage: giwt plan <subcommand> [flags]", "", "Subcommands:"];
  for (const { name, description, flags } of SUBCOMMAND_INFO) {
    const padded = name.padEnd(maxName);
    const flagsPart = flags ? ` (${flags})` : "";
    lines.push(`  ${padded}  ${description}${flagsPart}`);
  }
  lines.push("", "Run `giwt plan <sub> --help` for per-subcommand details");
  return lines;
}

export async function plan(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    for (const line of formatSubcommandHelp()) {
      raw(line);
    }
    return;
  }

  const sub = args[0] as Subcommand;
  const rest = args.slice(1);

  if (!SUBCOMMANDS.includes(sub)) {
    log("error", `unknown plan subcommand '${sub}'`);
    for (const line of formatSubcommandHelp()) {
      raw(line);
    }
    process.exit(1);
  }

  switch (sub) {
    case "backlog-sync":
      await runBacklogSync(rest, config);
      break;
    case "code-map":
      await runCodeMap(rest, config);
      break;
    case "gen-docs":
      await runGenDocs(rest, config);
      break;
    case "matrix":
      await runMatrix(rest, config);
      break;
    case "check-links":
      await runCheckLinks(rest, config);
      break;
    case "validate":
      await runValidateCmd(rest, config);
      break;
    case "status":
      await runStatus(rest, config);
      break;
  }
}

// ── backlog-sync ────────────────────────────────────────────────

async function runBacklogSync(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const fix = args.includes("--fix");
  const verbose = args.includes("--verbose");
  const unknown = args.filter(
    (a) => a !== "--fix" && a !== "--verbose" && a !== "--help" && a !== "-h",
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan backlog-sync [--fix] [--verbose]");
    raw("  Sync .plan/backlog/ index file maps ↔ tier files");
    raw("  --fix       apply automatic fixes (add orphans, drop phantoms)");
    raw("  --verbose   show per-file map state");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const backlogDir = join(planDir, "backlog");
  const indexFiles = ["priority.md", "open.md"];

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

// ── code-map ────────────────────────────────────────────────────

/** Build map sources using the configured planDir instead of hardcoded .plan */
function mapSourcesFor(planDir: string): Array<{ dir: string; kind: string; }> {
  return [
    { dir: `${planDir}/tickets`, kind: "ticket" },
    { dir: `${planDir}/epics`, kind: "epic" },
    { dir: "docs/spec", kind: "spec" },
    { dir: "docs/frontend", kind: "frontend" },
  ];
}

async function runCodeMap(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const isCheck = args.includes("--check");
  const findIdx = args.indexOf("--find");
  const hasFind = findIdx >= 0;
  const staleFlag = args.includes("--stale");
  const isHelp = args.includes("--help") || args.includes("-h");

  const unknown = args.filter(
    (a) =>
      a !== "--check" && a !== "--find" && a !== "--stale"
      && a !== "--help" && a !== "-h",
  );
  if (
    (unknown.length > 0 && !hasFind) || isHelp
    || (hasFind && unknown.length > 1)
  ) {
    raw("Usage: giwt plan code-map [--check] [--find <path>] [--stale]");
    raw("  Build/check/query reverse code→plan index");
    raw("  --check     verify committed index matches fresh rebuild (CI gate)");
    raw("  --find <p>  query owners of a src/ path");
    raw("  --stale     report src refs whose file no longer exists");
    process.exit(isHelp ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const mapPath = join(planDir, "code-map.json");
  const map = buildMap(config.worktreeRoot, mapSourcesFor(config.settings.paths.planDir));

  if (hasFind) {
    const queryPath = args[findIdx + 1];
    if (!queryPath) {
      log("error", "--find requires a path argument");
      process.exit(1);
    }
    const existing = readMap(mapPath);
    const { exact, prefix } = findOwners(existing, queryPath);
    if (exact.length > 0) {
      raw(queryPath);
      for (const e of exact) {
        raw(`  [${e.kind}] ${e.source}`);
      }
    } else if (prefix.length > 0) {
      raw(`${queryPath} (directory - ${prefix.length} nested path(s) referenced)`);
      for (const { path, entries } of prefix) {
        raw(`  ${path}`);
        for (const e of entries) {
          raw(`    [${e.kind}] ${e.source}`);
        }
      }
    } else {
      raw(`${queryPath} - not referenced by any plan/spec`);
    }
    return;
  }

  // --check is a CI gate: must NOT modify the working tree
  if (!isCheck) {
    writeMap(mapPath, map);
    log("info", `wrote ${mapPath} (${Object.keys(map).length} src paths)`);
  }

  if (isCheck) {
    if (!verifyFresh(mapPath, map)) {
      log("error", "code-map.json is stale — run `giwt plan code-map` to regenerate");
      process.exit(1);
    }
    log("success", "OK - code map is up to date");
  } else if (staleFlag) {
    const stale = findStale(config.worktreeRoot, map);
    if (stale.length > 0) {
      for (const s of stale) {
        log("warn", `stale src ref: ${s}`);
      }
      log(
        "warn",
        `${stale.length} stale src reference(s) - advisory (future/renamed files)`,
      );
    } else {
      log("success", "OK - all src references resolve");
    }
  }
}

// ── gen-docs ────────────────────────────────────────────────────

async function runGenDocs(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const isCheck = args.includes("--check");
  const unknown = args.filter(
    (a) => a !== "--help" && a !== "-h" && a !== "--check",
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan gen-docs [--check]");
    raw("  Generate .plan/epics-index.md from .plan/epics/epic-*.md files");
    raw("  --check  verify committed index matches fresh rebuild (CI gate)");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const epicsDir = join(planDir, "epics");
  const outPath = join(planDir, "epics-index.md");
  const backlogPath = join(planDir, "backlog", "open.md");

  if (isCheck) {
    if (!existsSync(outPath)) {
      log("error", "epics-index.md missing — run `giwt plan gen-docs` to generate");
      process.exit(1);
    }
    const epics = collectEpics(epicsDir);
    const fresh = generateIndex(epics, backlogPath);
    const committed = readFileSync(outPath, "utf8");
    if (fresh !== committed) {
      log("error", "epics-index.md is stale — run `giwt plan gen-docs` to regenerate");
      process.exit(1);
    }
    log("success", `OK - epics-index.md is up to date (${epics.length} epics)`);
    return;
  }

  const { epics } = genDocs(epicsDir, outPath, backlogPath);
  log("success", `wrote ${outPath} (${epics.length} epics)`);
}

// ── matrix ──────────────────────────────────────────────────────

async function runMatrix(args: string[], config: WorktreeConfig): Promise<void> {
  const isCheck = args.includes("--check");
  const json = args.includes("--json");
  const cooccurrence = args.includes("--cooccurrence");
  const unknown = args.filter(
    (a) =>
      a !== "--help" && a !== "-h" && a !== "--check" && a !== "--json"
      && a !== "--cooccurrence",
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan matrix [--check] [--json] [--cooccurrence]");
    raw("  Generate .plan/feature-matrix.md from the ticket index");
    raw("  --check          verify committed matrix matches fresh rebuild (CI gate)");
    raw("  --json           print the matrix as JSON on stdout (no file write)");
    raw("  --cooccurrence   append the tag×tag co-occurrence section");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }
  if (isCheck && json) {
    log("error", "--check and --json are mutually exclusive");
    process.exit(1);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const indexPath = join(planDir, "tickets", "index.json");
  const outPath = join(planDir, "feature-matrix.md");

  if (isCheck) {
    if (!existsSync(outPath)) {
      log("error", "feature-matrix.md missing — run `giwt plan matrix` to generate");
      process.exit(1);
    }
    // matrixOutput throws on a missing/corrupt index — main() catches and
    // reports with the path named, keeping stdout clean for pipelines.
    const fresh = matrixOutput(indexPath, { cooccurrence });
    if (readFileSync(outPath, "utf8") !== fresh.output) {
      log("error", "feature-matrix.md is stale — run `giwt plan matrix` to regenerate");
      process.exit(1);
    }
    log("success", `OK - feature-matrix.md is up to date (${fresh.matrix.total} tickets)`);
    return;
  }

  if (json) {
    const { matrix } = matrixOutput(indexPath, { cooccurrence });
    raw(JSON.stringify(matrix, null, 2));
    process.exitCode = 0;
    return;
  }

  const { matrix } = genMatrix(indexPath, outPath, { cooccurrence });
  log("success", `wrote ${outPath} (${matrix.total} tickets)`);
}

// ── check-links ─────────────────────────────────────────────────

async function runCheckLinks(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  const unknown = args.filter(
    (a) => a !== "--help" && a !== "-h",
  );
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan check-links");
    raw("  Validate internal markdown links + TASK refs");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const planDir = config.settings.paths.planDir;
  const scanDirs = ["docs", planDir];
  const ticketsDir = config.settings.paths.tickets;
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
  if (total > 0) {
    log("error", `${total} broken link(s)/ref(s) found`);
    process.exit(1);
  }
  log(
    "success",
    `OK - ${result.fileCount} markdown file(s), ${result.srcFileCount} source file(s); all internal links and comment citations resolve`,
  );
}

// ── validate ────────────────────────────────────────────────────

async function runValidateCmd(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  let gatesArg = "all";
  let skipGatesArg = "";
  const fix = args.includes("--fix");
  const json = args.includes("--json");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--gates" && args[i + 1]) {
      gatesArg = args[++i]!;
    } else if (args[i] === "--skip-gates" && args[i + 1]) {
      skipGatesArg = args[++i]!;
    }
  }

  const isHelp = args.includes("--help") || args.includes("-h");
  if (isHelp) {
    raw("Usage: giwt plan validate [--gates <list>] [--skip-gates <list>] [--fix] [--json]");
    raw("  Comprehensive .plan/ validation");
    raw("  --gates       comma-separated gate list (default: all)");
    raw(
      "                gates: format,linkage,backlog,tickets,code-map,links,spdx,naming,epics-doc,matrix,all",
    );
    raw("  --skip-gates  run all gates except these (mutually exclusive with --gates)");
    raw("  --fix         auto-fix fixable gates (backlog, tickets, code-map, epics-doc, matrix)");
    raw("                unfixable failing gates are reported with a manual next step");
    raw("  --json        machine-readable full result on stdout (every finding, no cap)");
    return;
  }

  if (gatesArg !== "all" && skipGatesArg) {
    log("error", "--gates and --skip-gates are mutually exclusive");
    process.exit(1);
  }

  let gateNames: string[];
  if (skipGatesArg) {
    const skipSet = new Set(skipGatesArg.split(",").map((g) => g.trim()).filter(Boolean));
    gateNames = ALL_GATES.filter((g) => !skipSet.has(g));
    if (gateNames.length === 0) {
      log("error", "--skip-gates would skip all gates");
      process.exit(1);
    }
  } else {
    gateNames = gatesArg.split(",").map((g) => g.trim()).filter(Boolean);
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const result = runValidate({
    projectRoot: config.worktreeRoot,
    worktreeRoot: config.worktreeRoot,
    ticketsDir: join(planDir, "tickets"),
    epicsDir: join(planDir, "epics"),
    backlogDir: join(planDir, "backlog"),
    planDir,
    srcDir: "src",
    codeMapPath: join(planDir, "code-map.json"),
    epicsIndexPath: join(planDir, "epics-index.md"),
    mapSources: mapSourcesFor(config.settings.paths.planDir),
    linkScanDirs: ["docs", config.settings.paths.planDir],
    backlogIndexFiles: ["priority.md", "open.md"],
    gates: gateNames as import("../plan/validate").GateName[],
    runSync: (root, opts) =>
      runSync(root, { fix: opts.fix, verbose: opts.verbose, ticketsPath: opts.ticketsPath }),
    ...(fix ? { fix: true } : {}),
  });

  if (json) {
    // Machine contract (mirrors `doctor check --json`): the full result —
    // every finding, no cap — is the only stdout payload. process.exitCode
    // instead of process.exit so piped JSON is never truncated.
    raw(JSON.stringify(result, null, 2));
    process.exitCode = result.pass ? 0 : 1;
    return;
  }

  section("Plan Validation Results");

  for (const line of renderValidateSummary(result)) {
    raw(line);
  }

  raw("");
  if (result.fixedCount > 0) {
    log("info", `${result.fixedCount} fix(es) applied — re-run validate to confirm`);
  }
  if (result.pass) {
    log("success", `All gates pass (${result.results.length} checked)`);
    process.exit(0);
  } else {
    log("error", `${result.issueCount} issue(s) found across ${result.results.length} gates`);
    process.exit(1);
  }
}

// ── status ──────────────────────────────────────────────────────

/** Per-subsystem status entry for the plan status overview. */
interface StatusEntry {
  label: string;
  count: number;
  note: string;
}

async function runStatus(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    raw("Usage: giwt plan status");
    raw("  Show .plan/ health summary (ticket count, epic count, sync state)");
    return;
  }

  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  const ticketsDir = join(planDir, "tickets");
  const epicsDir = join(planDir, "epics");
  const backlogDir = join(planDir, "backlog");
  const codeMapPath = join(planDir, "code-map.json");
  const epicsIndexPath = join(planDir, "epics-index.md");

  const entries: StatusEntry[] = [];

  // Tickets
  const ticketCount = existsSync(ticketsDir)
    ? readdirSync(ticketsDir).filter((f) => f.endsWith(".md")).length
    : 0;
  entries.push({
    label: "Tickets",
    count: ticketCount,
    note: existsSync(ticketsDir) ? "" : "(dir missing)",
  });

  // Epics
  const epicCount = existsSync(epicsDir)
    ? readdirSync(epicsDir).filter((f) => f.startsWith("epic-") && f.endsWith(".md")).length
    : 0;
  entries.push({
    label: "Epics",
    count: epicCount,
    note: existsSync(epicsDir) ? "" : "(dir missing)",
  });

  // Backlog tiers
  const backlogResult = existsSync(backlogDir)
    ? reconcile(backlogDir, ["priority.md", "open.md"])
    : null;
  const backlogFileCount = existsSync(backlogDir)
    ? readdirSync(backlogDir).filter((f) => f.endsWith(".md")).length
    : 0;
  entries.push({
    label: "Backlog files",
    count: backlogFileCount,
    note: backlogResult
      ? backlogResult.issueCount === 0
        ? "in sync"
        : `${backlogResult.issueCount} issue(s)`
      : "(dir missing)",
  });

  // Code map
  const codeMapExists = existsSync(codeMapPath);
  const codeMapCount = codeMapExists
    ? Object.keys(readMap(codeMapPath)).length
    : 0;
  entries.push({
    label: "Code map",
    count: codeMapCount,
    note: codeMapExists ? "exists" : "(missing — run `giwt plan code-map`)",
  });

  // Epics index
  const epicsIndexExists = existsSync(epicsIndexPath);
  entries.push({
    label: "Epics index",
    count: epicsIndexExists ? 1 : 0,
    note: epicsIndexExists ? "exists" : "(missing — run `giwt plan gen-docs`)",
  });

  // Print
  section("Plan Status");
  const maxLabel = Math.max(...entries.map((e) => e.label.length));
  for (const { label, count, note } of entries) {
    const padded = label.padEnd(maxLabel);
    const notePart = note ? `  ${note}` : "";
    raw(`  ${padded}  ${String(count).padStart(3)}${notePart}`);
  }
}
