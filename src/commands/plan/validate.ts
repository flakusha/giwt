// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { join } from "node:path";
import { BACKLOG_INDEX_FILES } from "../../plan/backlog-sync";
import {
  ALL_GATES,
  renderValidateSummary,
  resolveFromRoot,
  runValidate,
} from "../../plan/validate";
import { runSync } from "../../tickets/sync-index";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw, section } from "../../utils/output";
import { mapSourcesFor } from "./code-map";

export async function runValidateCmd(
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
      "                gates: format,linkage,backlog,tickets,code-map,links,spdx,naming,epics-doc,matrix,status-vocab,all",
    );
    raw("                status-vocab: **Status:** values must use the canonical vocabulary");
    raw(
      "                (Not Started, In Progress, Blocked, Done, Wontfix, Postponed); aliases via",
    );
    raw("                [status.aliases] in giwt.toml, defaults: not started→Not Started;");
    raw("                in-progress/in progress→In Progress; open/open (planning)→Not Started;");
    raw("                closed→Done; cancelled/dropped→Wontfix");
    raw("  --skip-gates  run all gates except these (mutually exclusive with --gates)");
    raw(
      "  --fix         auto-fix fixable gates (backlog, tickets, code-map, epics-doc, matrix, status-vocab)",
    );
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
    backlogIndexFiles: [...BACKLOG_INDEX_FILES],
    gates: gateNames as import("../../plan/validate").GateName[],
    runSync: (root, opts) =>
      runSync(root, { fix: opts.fix, verbose: opts.verbose, ticketsPath: opts.ticketsPath }),
    ...(fix ? { fix: true } : {}),
    ...(Object.keys(config.settings.status.aliases).length > 0
      ? { statusAliases: config.settings.status.aliases }
      : {}),
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
