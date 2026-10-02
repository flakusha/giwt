// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * feature-matrix.md freshness gate for the .plan/ validator, including its
 * --fix path (regenerate + re-verify; regeneration is a millisecond-scale
 * pure projection of the ticket index).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { genMatrix, matrixOutput } from "../feature-matrix";
import type { Finding } from "./types";

export function runMatrixGate(
  planDir: string,
  fix: boolean,
): { findings: Finding[]; pass: boolean; fixMsgs: string[]; } {
  const indexPath = join(planDir, "tickets", "index.json");
  const outPath = join(planDir, "feature-matrix.md");
  const findings: Finding[] = [];
  if (!existsSync(indexPath)) {
    findings.push({
      gate: "matrix",
      level: "error",
      message: `${indexPath}: ticket index missing — run \`giwt sync\``,
    });
  } else {
    try {
      const fresh = matrixOutput(indexPath);
      if (!existsSync(outPath)) {
        findings.push({
          gate: "matrix",
          level: "error",
          message: `${outPath}: missing — run \`giwt plan matrix\` to generate`,
        });
      } else if (readFileSync(outPath, "utf8") !== fresh.output) {
        findings.push({
          gate: "matrix",
          level: "error",
          message: `${outPath}: stale — run \`giwt plan matrix\` to regenerate`,
        });
      }
    } catch (error) {
      findings.push({
        gate: "matrix",
        level: "error",
        message: (error as Error).message,
      });
    }
  }
  let pass = findings.length === 0;
  let fixMsgs: string[] = [];
  if (fix && !pass && existsSync(indexPath)) {
    try {
      const { matrix } = genMatrix(indexPath, outPath);
      const rechecked = matrixOutput(indexPath);
      const clean = existsSync(outPath) && readFileSync(outPath, "utf8") === rechecked.output;
      if (clean) {
        // Regeneration resolves every finding — drop them so both the
        // per-gate pass and the aggregated issueCount reflect the
        // post-fix state (no re-run needed, unlike the tickets gate).
        findings.length = 0;
        pass = true;
      }
      fixMsgs = [`regenerated ${outPath} (${matrix.total} tickets)`];
    } catch {
      /* leave unfixed — findings already name the failure */
    }
  }
  return { findings, pass, fixMsgs };
}
