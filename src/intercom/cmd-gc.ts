// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt intercom gc` — retention, dry-run by default (--apply to mutate).
 * See gc.ts for the policy; this module renders the plan and applies it.
 */

import { raw } from "../utils/output";
import { applyGc, type GcPlan, planGc } from "./gc";
import { intercomStateRoot, resolveExistingStore } from "./store";
import type { IntercomRetention } from "./types";

export interface GcOptions {
  apply: boolean;
  retention: IntercomRetention;
  backendName: "jsonl" | "pijul";
}

function describe(plan: GcPlan): string {
  const parts = [
    `${plan.archived.length} fixed → archive`,
    `${plan.stamped.length} stale stamps`,
    `events ${plan.eventsBefore}→${plan.eventsAfter}`,
  ];
  if (plan.orphans.length > 0) parts.push(`${plan.orphans.length} orphan store(s)`);
  return parts.join(", ");
}

/** Print the plan (dry-run) or apply it and print what changed. */
export function runGc(repoRoot: string, opts: GcOptions): GcPlan {
  const { storeDir } = resolveExistingStore(repoRoot);
  const stateRoot = intercomStateRoot();
  const plan = planGc(storeDir, stateRoot, opts.retention);
  if (opts.apply) {
    applyGc(storeDir, stateRoot, opts.backendName, opts.retention, plan);
    raw(`  applied: ${describe(plan)}`);
  } else {
    for (const item of plan.archived) raw(`  would archive: ${item.name} (${item.ageDays}d)`);
    for (const item of plan.stamped) raw(`  would stamp stale: ${item.name} (${item.ageDays}d)`);
    for (const orphan of plan.orphans) raw(`  orphan store: ${orphan.name} (${orphan.why})`);
    raw(`  plan: ${describe(plan)}`);
  }
  return plan;
}
