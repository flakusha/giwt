// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `.plan/tickets/index.json` projection (ported from loop-lore's
 * plan-index-projection.ts, commits 1f970fa + 125de19) — pushes the `.md`
 * header fields onto entries giwt already indexes. Separate from the
 * markdown rewrite pass (metadata-fields.ts) because it targets a different
 * artifact (index.json, regenerated post-merge by giwt) under a different
 * write policy.
 *
 * `giwt sync --fix` writes `tags`/`epic` onto an index entry only when it
 * ADOPTS an orphan file. For an entry already in the index it repairs hashes
 * and sources but never re-reads the .md fields — so adding `**Tags:**` to a
 * long-filed ticket changes nothing until the ticket is deleted and re-added.
 * This pass projects the .md fields onto existing entries so the rewrite
 * actually reaches the generated matrix.
 *
 * Tags are frontmatter-wins, not fill-only: a ticket whose .md tag list
 * diverges from the entry is re-written from the .md, so prose fragments
 * scraped into an entry's tags by a header-window parse are repaired, not
 * preserved forever. The documented retention semantic: a .md with NO Tags
 * line leaves the entry untouched — stale tags are retained, nothing is
 * inferred (a wrong guessed tag is worse than a stale one). Epic stays
 * fill-only-empty — ownership has its own resolver.
 */

import { parseEpicField, parseTagsField } from "../tickets/sync-parse";

export interface IndexEntryLike {
  tags?: string[];
  epic?: string;
  source?: string;
}

/**
 * Index entries in the canonical order giwt writes them.
 *
 * `localeCompare`, NOT the default comparator: giwt sorts with
 * `localeCompare` (sync-index.ts), the default sort is code-unit order.
 * Where both `BUG-redos-…` and `BUG-REDOS-…` exist, a code-unit sort moves
 * the lowercase key on every write — a diff that looks like the pass touched
 * an entry it never read. Matching giwt makes the write a no-op on key order.
 */
export function canonicalIndexOrder(
  index: Record<string, IndexEntryLike>,
): Record<string, IndexEntryLike> {
  return Object.fromEntries(
    Object.entries(index).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Project .md tags/epic onto index entries (field parsing via the shared
 * sync-parse parsers — one implementation). Returns the updated index plus
 * per-field counts. Tags are frontmatter-wins: an entry whose `tags` are
 * empty OR diverge from the .md list is (re)written from the .md; a .md with
 * no Tags line leaves the entry untouched (stale tags RETAINED — documented
 * semantic). Epic stays fill-only-empty. Status, hash, and provenance stay
 * giwt's business.
 */
export function projectIndex(
  index: Record<string, IndexEntryLike>,
  readFile: (source: string) => string | null,
): { next: Record<string, IndexEntryLike>; tagsFilled: number; epicsFilled: number; } {
  const next = { ...index };
  let tagsFilled = 0;
  let epicsFilled = 0;
  for (const [extid, entry] of Object.entries(index)) {
    if (!entry.source) continue;
    const text = readFile(entry.source);
    if (text === null) continue;
    // Header region only, exactly as parseTicketText scopes it.
    const header = text.split("\n").slice(0, 30).join("\n");
    const tags = parseTagsField(header);
    const epic = parseEpicField(header);
    const patch: IndexEntryLike = {};
    if (
      tags.length > 0
      && JSON.stringify(tags) !== JSON.stringify(entry.tags ?? [])
    ) {
      patch.tags = tags;
      tagsFilled++;
    }
    if (epic && !entry.epic) {
      patch.epic = epic;
      epicsFilled++;
    }
    if (patch.tags || patch.epic) next[extid] = { ...entry, ...patch };
  }
  return { next, tagsFilled, epicsFilled };
}
