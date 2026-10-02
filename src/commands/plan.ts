// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Plan command — subcommand dispatcher for .plan/ tooling.
 *
 * Subcommands:
 *   code-map      Build/check/query reverse code→plan index (--check, --find <path>)
 *   gen-docs      Generate .plan/epics-index.md from .plan/epics/
 *   matrix        Generate .plan/feature-matrix.md from the ticket index
 *   check-links   Validate internal markdown links + TASK refs
 *   validate      Comprehensive .plan/ validation (--gates <list>)
 *   status         Show .plan/ health summary (--tickets: per-ticket status)
 */

import { type WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import { runCheckLinks } from "./plan/check-links";
import { runCodeMap } from "./plan/code-map";
import { runGenDocs } from "./plan/gen-docs";
import { runMatrix } from "./plan/matrix";
import { runStatus } from "./plan/status";
import { runValidateCmd } from "./plan/validate";

export { mapSourcesFor } from "./plan/code-map";

/** Structured subcommand metadata — drives help text + validation. */
interface SubcommandInfo {
  name: string;
  description: string;
  flags: string;
}

const SUBCOMMAND_INFO: SubcommandInfo[] = [
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
  {
    name: "status",
    description: "Show .plan/ health summary",
    flags: "--tickets, --json, --toml, --emoji",
  },
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
