// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * The `interconnect` gate for `plan validate`: broken **Related:** targets
 * (file/field/path), a missing or stale generated pair, and graph-level
 * error findings all fail the gate; --fix regenerates the pair and
 * re-checks freshness (broken refs stay broken — they need edits).
 */

import { join } from "node:path";
import { generatedHeader } from "../../utils/reuse-toml";
import type { Finding } from "../validate/types";
import { freshnessFindings, interconnectOutputs, writeInterconnectFiles } from "./render";
import type { InterconnectOptions } from "./types";

export interface InterconnectGateOptions extends InterconnectOptions {
  /** Plan dir receiving .plan/interconnect.{json,md}. */
  planDir: string;
  fix: boolean;
}

export function runInterconnectGate(
  { planDir, fix, ...graphOpts }: InterconnectGateOptions,
): { findings: Finding[]; pass: boolean; fixMsgs: string[]; } {
  const mdHeader = generatedHeader(join(planDir, "interconnect.md"), ".md");
  let outputs;
  try {
    outputs = interconnectOutputs(graphOpts, mdHeader);
  } catch (error) {
    // Snapshot divergence or unreadable input — the gate fails loudly
    // instead of comparing against a partial graph.
    return {
      findings: [{ gate: "interconnect", level: "error", message: (error as Error).message }],
      pass: false,
      fixMsgs: [],
    };
  }
  const findings: Finding[] = [
    ...outputs.graph.findings.map((f) => ({
      gate: "interconnect" as const,
      level: f.level,
      message: f.message,
    })),
    ...freshnessFindings(planDir, outputs).map((f) => ({
      gate: "interconnect" as const,
      level: "error" as const,
      message: f.message,
    })),
  ];
  let pass = !findings.some((f) => f.level === "error");
  let fixMsgs: string[] = [];
  if (fix && !pass) {
    try {
      writeInterconnectFiles(planDir, outputs);
      const remaining = freshnessFindings(planDir, outputs);
      // Freshness findings resolve; graph findings (broken refs) persist.
      findings.length = 0;
      findings.push(
        ...outputs.graph.findings.map((f) => ({
          gate: "interconnect" as const,
          level: f.level,
          message: f.message,
        })),
      );
      pass = remaining.length === 0 && !findings.some((f) => f.level === "error");
      // When broken refs keep the gate red, report it as unfixable (no
      // fix notes) so the summary names the manual next step instead of
      // claiming a fix landed.
      fixMsgs = pass ? [`regenerated interconnect.json and interconnect.md in ${planDir}`] : [];
    } catch (error) {
      // Leave unfixed — surface WHY the write failed instead of swallowing
      // it; the stale-pair findings above stay and now name the cause too.
      findings.push({
        gate: "interconnect",
        level: "error",
        message: `--fix write failed: ${(error as Error).message}`,
      });
    }
  }
  return { findings, pass, fixMsgs };
}
