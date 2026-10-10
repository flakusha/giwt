// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orphan detection over the ticket index vs `.plan/` frontmatter (ported
 * from loop-lore's plan-report-queries.ts): an ORPHAN TAG is a tag on an
 * index entry that no .md frontmatter declares (case-insensitive matching,
 * placeholder tokens excluded); an ORPHAN BINDING is an index epic value
 * naming no .plan/epics/<slug>.md.
 *
 * .md tag parsing goes through the shared sync-parse field parsers — there
 * is no second tag parser here. Detection is advisory-grade: consumers
 * (plan report, the tickets gate) decide warn vs fail. Both detectors are
 * pure — callers hand in file texts and an epic-exists probe, so tests and
 * gates stay filesystem-free.
 */

import { parseTagsField } from "../tickets/sync-parse";
import { splitEpicCandidates } from "./epic-candidates";
import type { IndexEntryLike } from "./index-projection";
import { TAG_PLACEHOLDER } from "./metadata-fields";

/** Index entries keyed by extid (shape of `.plan/tickets/index.json`). */
export type PlanIndex = Record<string, IndexEntryLike>;

/** Placeholder tokens (`(none)`, `n/a`, `-`, `tbd`) mean "no tags". */
function isRealTag(t: string): boolean {
  return t.length > 0 && !TAG_PLACEHOLDER.test(t);
}

/**
 * Every tag declared by any plan .md frontmatter (header region, shared
 * parser), lowercased for case-insensitive matching.
 */
export function declaredTags(files: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const text of Object.values(files)) {
    for (const t of parseTagsField(text.split("\n").slice(0, 30).join("\n"))) {
      if (isRealTag(t)) out.add(t.toLowerCase());
    }
  }
  return out;
}

/** (a) Index tags no plan .md frontmatter declares — stale or corrupted rows. */
export function orphanTags(
  index: PlanIndex,
  declared: Set<string>,
): { extid: string; tag: string; }[] {
  const rows: { extid: string; tag: string; }[] = [];
  for (const [extid, entry] of Object.entries(index)) {
    for (const tag of entry.tags ?? []) {
      if (isRealTag(tag) && !declared.has(tag.toLowerCase())) {
        rows.push({ extid, tag });
      }
    }
  }
  return rows;
}

/**
 * (b) Index `epic` bindings (any candidate) naming no .plan/epics/<slug>.md.
 * `epicExists` receives each normalized candidate slug.
 */
export function orphanBindings(
  index: PlanIndex,
  epicExists: (slug: string) => boolean,
): { extid: string; epic: string; }[] {
  const rows: { extid: string; epic: string; }[] = [];
  for (const [extid, entry] of Object.entries(index)) {
    const raw = entry.epic ?? "";
    if (!raw) continue;
    const bad = splitEpicCandidates(raw).filter((c) => !epicExists(c));
    if (bad.length > 0) rows.push({ extid, epic: bad.join(", ") });
  }
  return rows;
}
