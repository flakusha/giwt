// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Generated .plan/ artifact initialization probe.
 *
 * The five generated artifacts are retired from tracking (rebuildable,
 * gitignored; regenerate via `bun run plan:artifacts`, which postinstall
 * runs on fresh clones). This probe powers a one-line non-gating hint at
 * the surfaces where plan state is consulted: missing artifacts are
 * reported, never invented — the "missing artifacts never invented"
 * invariant of sync --fix and finalize 5c stays intact.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/output";

/** The generated artifact names, in reporting order. */
const GENERATED_PLAN_ARTIFACTS = [
  "code-map.json",
  "epics-index.md",
  "feature-matrix.md",
  "interconnect.json",
  "interconnect.md",
] as const;

/**
 * Which generated artifacts are missing under `planDir`. Cheap by design:
 * existence checks only, no content reads.
 */
export function missingPlanArtifacts(planDir: string): string[] {
  return GENERATED_PLAN_ARTIFACTS.filter((name) => !existsSync(join(planDir, name)));
}

/**
 * One-line info hint when generated artifacts are missing. Non-gating by
 * contract: never fails, never creates files — regeneration stays the
 * caller's explicit `bun run plan:artifacts` (or the individual giwt plan
 * commands).
 */
export function warnMissingPlanArtifacts(planDir: string): void {
  const missing = missingPlanArtifacts(planDir);
  if (missing.length === 0) return;
  log(
    "info",
    `plan artifacts not initialized: ${missing.join(", ")}`
      + " — regenerate with giwt plan code-map/matrix/gen-docs/links --write or bun run plan:artifacts",
  );
}
