// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { join } from "node:path";
import {
  freshnessFindings,
  type InterconnectOutputs,
  interconnectOutputs,
  nodeReport,
  siblingsOf,
  whoConsumes,
  whoProduces,
  writeInterconnectFiles,
} from "../../plan/interconnect";
import { resolveFromRoot } from "../../plan/validate";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";
import { generatedHeader } from "../../utils/reuse-toml";

const USAGE_LINES = [
  "Usage: giwt plan links [--write] [--check] [--json] [--for <id>] [--who-produces <target>] [--who-consumes <target>] [--siblings <id>]",
  "  Derive the producer/consumer/sibling graph over .plan/ tickets/epics + src/ ownership",
  "  (default: read-only report; never writes)",
  "  --write               regenerate .plan/interconnect.json and .plan/interconnect.md (atomic)",
  "  --check               CI gate: the pair must exist and be byte-fresh; broken **Related:** targets fail",
  "  --json                machine-readable graph/result on stdout",
  "  --for <id>            every edge touching a node",
  "  --who-produces <t>    owners of src path <t>; or the nodes <id> consumes from",
  "  --who-consumes <t>    consumers of src path <t>; or the nodes depending on <id>",
  "  --siblings <id>       co-owners of shared src paths with no Related direction",
  "  Targets accept plan ids (slug or typed id) or src/ paths; the query flags and",
  "  --write/--check are mutually exclusive.",
];

const VALUE_FLAGS: Record<string, true> = {
  "--for": true,
  "--who-produces": true,
  "--who-consumes": true,
  "--siblings": true,
};

interface LinksArgs {
  write: boolean;
  check: boolean;
  json: boolean;
  query: { flag: string; target: string; } | null;
}

/** Strict flag scan: any unknown token, missing value, duplicate query, or
 * mode conflict returns null → usage + exit 1 (0 for --help). */
function parseArgs(args: string[]): LinksArgs | null {
  const parsed: LinksArgs = { write: false, check: false, json: false, query: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") return null;
    if (a === "--write") parsed.write = true;
    else if (a === "--check") parsed.check = true;
    else if (a === "--json") parsed.json = true;
    else if (a !== undefined && VALUE_FLAGS[a] === true) {
      const target = args[i + 1];
      if (target === undefined || parsed.query !== null) return null;
      parsed.query = { flag: a, target };
      i++;
    } else return null;
  }
  const modes = [parsed.write, parsed.check, parsed.query !== null].filter(Boolean).length;
  return modes > 1 ? null : parsed;
}

function graphOpts(config: WorktreeConfig) {
  const planDir = resolveFromRoot(config.worktreeRoot, config.settings.paths.planDir);
  return {
    planDir,
    projectRoot: config.worktreeRoot,
    ticketsDir: join(planDir, "tickets"),
    epicsDir: join(planDir, "epics"),
    codeMapPath: join(planDir, "code-map.json"),
    indexPath: join(planDir, "tickets", "index.json"),
  };
}

function errorFindings(outputs: InterconnectOutputs) {
  return outputs.graph.findings.filter((f) => f.level === "error");
}

export async function runLinks(args: string[], config: WorktreeConfig): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed === null) {
    for (const line of USAGE_LINES) raw(line);
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }
  const opts = graphOpts(config);
  // Same header derivation as the validate freshness gate — the freshness
  // comparison is byte equality, so a divergence here would report every
  // repo stale (mirrors the matrix command/gate pair).
  const outputs = interconnectOutputs(
    opts,
    generatedHeader(join(opts.planDir, "interconnect.md"), ".md"),
  );

  if (parsed.write) {
    writeInterconnectFiles(opts.planDir, outputs);
    log(
      "success",
      `wrote ${join(opts.planDir, "interconnect.json")} and interconnect.md `
        + `(${outputs.graph.nodes.length} nodes, ${outputs.graph.edges.length} edges)`,
    );
    for (const f of errorFindings(outputs)) log("error", f.message);
    if (errorFindings(outputs).length > 0) process.exit(1);
    return;
  }

  if (parsed.check) {
    const stale = freshnessFindings(opts.planDir, outputs);
    for (const f of stale) log("error", f.message);
    for (const f of errorFindings(outputs)) log("error", f.message);
    if (stale.length > 0 || errorFindings(outputs).length > 0) process.exit(1);
    log(
      "success",
      `OK - interconnect pair is up to date (${outputs.graph.nodes.length} nodes, `
        + `${outputs.graph.edges.length} edges)`,
    );
    return;
  }

  if (parsed.query !== null) {
    runQuery(parsed, outputs);
    return;
  }

  if (parsed.json) {
    raw(JSON.stringify(outputs.graph, null, 2));
    process.exitCode = errorFindings(outputs).length > 0 ? 1 : 0;
    return;
  }

  reportSummary(outputs);
  if (errorFindings(outputs).length > 0) process.exit(1);
}

function runQuery(parsed: LinksArgs, outputs: InterconnectOutputs): void {
  const { flag, target } = parsed.query!;
  if (flag === "--for") {
    const report = nodeReport(outputs.graph, target);
    if (report === null) unknownTarget(target);
    if (parsed.json) {
      raw(JSON.stringify(report, null, 2));
      return;
    }
    raw(
      `${report!.node.id} (${report!.node.kind}, ${report!.node.status}) — ${report!.node.title}`,
    );
    for (const src of report!.node.srcRefs) raw(`  produces ${src}`);
    for (const e of report!.edges) {
      raw(`  ${e.from} --${e.kind}--> ${e.to}${e.via ? ` via ${e.via}` : ""}`);
    }
    return;
  }
  if (flag === "--siblings") {
    const edges = siblingsOf(outputs.graph, target);
    if (edges === null) unknownTarget(target);
    if (parsed.json) {
      raw(JSON.stringify(edges, null, 2));
      return;
    }
    for (const e of edges!) raw(`${e.from} <-> ${e.to} via ${e.via ?? ""}`);
    return;
  }
  const ids = flag === "--who-produces"
    ? whoProduces(outputs.graph, target)
    : whoConsumes(outputs.graph, target);
  if (ids === null) unknownTarget(target);
  if (parsed.json) {
    raw(JSON.stringify({ target, ids }, null, 2));
    return;
  }
  for (const id of ids!) raw(id);
}

function unknownTarget(target: string): never {
  log("error", `interconnect: no node or src path '${target}' — try \`giwt plan links --json\``);
  process.exit(1);
}

function reportSummary(outputs: InterconnectOutputs): void {
  const g = outputs.graph;
  const hubs = g.srcNodes.filter((s) => s.owners.length > 1);
  raw(
    `interconnect: ${g.nodes.length} nodes (${g.srcNodes.length} src paths, `
      + `${hubs.length} shared hubs), ${g.edges.length} edges`,
  );
  for (const h of hubs.slice(0, 10)) raw(`  hub ${h.path}: ${h.owners.join(", ")}`);
  if (hubs.length > 10) {
    raw(`  … and ${hubs.length - 10} more hubs — full graph: .plan/interconnect.md`);
  }
  for (const f of g.findings) raw(`  ${f.level === "error" ? "✗" : "⚠"} ${f.message}`);
  if (errorFindings(outputs).length === 0) {
    raw("generate: giwt plan links --write · gate: giwt plan links --check | giwt plan validate");
  }
}
