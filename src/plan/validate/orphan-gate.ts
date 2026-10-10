// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Advisory orphan findings for the `tickets` gate of `giwt plan validate`
 * (detection ported from loop-lore's report-plan-metadata). POLICY —
 * advisory-first, deliberately: an orphan tag is a tag on an index entry no
 * .md frontmatter declares, an orphan binding is an index epic naming no
 * .plan/epics/<slug>.md. Real repos carry dozens-to-hundreds of both (the
 * reference loop-lore tree: 13 orphan tags / 149 orphan bindings), so a
 * blocking default would red-gate every consuming repo on day one. These
 * findings are `warn` level: reported, but the gate stays green. Promotion
 * to a blocking gate is a later, opt-in decision.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyIndexStamp } from "../../tickets/index-stamp";
import type { PlanIndex } from "../orphan-detect";
import { declaredTags, orphanBindings, orphanTags } from "../orphan-detect";
import type { Finding } from "./types";

export interface OrphanGateOptions {
  ticketsDir: string;
  epicsDir: string;
}

/**
 * Warn-level findings naming every orphan tag and orphan epic binding.
 * Never errors — see the policy note above. A missing index or plan dirs is
 * not a finding here: the sync-based part of the tickets gate owns
 * existence errors.
 */
export function checkOrphans(opts: OrphanGateOptions): Finding[] {
  const findings: Finding[] = [];
  const indexPath = join(opts.ticketsDir, "index.json");
  if (!existsSync(indexPath)) return findings;
  // Never errors (policy above) — but a hand-edited index must not be
  // silently aggregated either: report it as the advisory remedy instead.
  if (verifyIndexStamp(indexPath) === "mismatch") {
    findings.push({
      gate: "tickets",
      level: "warn",
      message:
        `${indexPath}: manually edited — frontmatter is source of truth; edit the .md and run giwt sync`,
    });
    return findings;
  }
  let index: PlanIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8")) as PlanIndex;
  } catch {
    return findings;
  }
  const files: Record<string, string> = {};
  for (const dir of [opts.ticketsDir, opts.epicsDir]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      files[join(dir, f)] = readFileSync(join(dir, f), "utf8");
    }
  }
  const declared = declaredTags(files);
  const epicExists = (slug: string): boolean => existsSync(join(opts.epicsDir, `${slug}.md`));
  for (const { extid, tag } of orphanTags(index, declared)) {
    findings.push({
      gate: "tickets",
      level: "warn",
      message: `${extid}: orphan tag "${tag}" — declared by no plan .md frontmatter`
        + " (advisory: does not fail the gate)",
    });
  }
  for (const { extid, epic } of orphanBindings(index, epicExists)) {
    findings.push({
      gate: "tickets",
      level: "warn",
      message: `${extid}: orphan epic binding "${epic}" — names no epic .md file`
        + " (advisory: does not fail the gate)",
    });
  }
  return findings;
}
