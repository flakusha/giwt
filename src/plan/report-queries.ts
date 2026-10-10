// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Read-only reconciliation queries for `giwt plan report` (ported from
 * loop-lore's plan-report-queries.ts): byTag/byEpic lookups, aggregate
 * totals, and the dangling **Related:** scan. All pure — callers hand in
 * the parsed index, .md texts, and a known-slug set. Orphan detection
 * lives in orphan-detect.ts (shared with the validate tickets gate);
 * status classification reuses the status vocabulary (status-vocab.ts).
 */

import { splitEpicCandidates } from "./epic-candidates";
import type { IndexEntryLike } from "./index-projection";
import { relatedRefs, TAG_PLACEHOLDER } from "./metadata-fields";
import type { PlanIndex } from "./orphan-detect";
import { resolveStatus } from "./status-vocab";

interface EntryRow {
  extid: string;
  status: string;
  source: string;
}

function entryStatus(entry: IndexEntryLike): string {
  return (entry as { status?: string; }).status ?? "";
}

function entryRow(extid: string, entry: IndexEntryLike): EntryRow {
  return { extid, status: entryStatus(entry), source: entry.source ?? "" };
}

/** Case-insensitive `tags <tag>` query over index entries. */
export function byTag(index: PlanIndex, tag: string): EntryRow[] {
  const needle = tag.toLowerCase();
  const rows: EntryRow[] = [];
  for (const [extid, entry] of Object.entries(index)) {
    if ((entry.tags ?? []).some((t) => t.toLowerCase() === needle)) {
      rows.push(entryRow(extid, entry));
    }
  }
  return rows;
}

/** Case-insensitive `epic <id>` query over index bindings; `.md` tolerated. */
export function byEpic(index: PlanIndex, epicId: string): EntryRow[] {
  const needle = epicId.toLowerCase().replace(/\.md$/i, "");
  const rows: EntryRow[] = [];
  for (const [extid, entry] of Object.entries(index)) {
    const candidates = splitEpicCandidates(entry.epic ?? "").map((c) => c.toLowerCase());
    if (candidates.includes(needle)) rows.push(entryRow(extid, entry));
  }
  return rows;
}

export interface Aggregate {
  tickets: number;
  distinctTags: number;
  bindings: number;
  /** Entries whose status classifies Done under the status vocabulary. */
  done: number;
  topTags: [string, number][];
  topEpics: [string, number][];
}

/**
 * Totals + top-10 tags/epics by frequency. Placeholder tokens (`(none)`,
 * `n/a`, `-`, `tbd`) never count as tags; `done` classifies each entry's
 * status through resolveStatus so freeform spellings ("✅ Complete",
 * "duplicate-of-…") count as done exactly like the gates see them.
 */
export function aggregate(index: PlanIndex): Aggregate {
  const tagCounts = new Map<string, number>();
  const epicCounts = new Map<string, number>();
  let bindings = 0;
  let done = 0;
  for (const entry of Object.values(index)) {
    for (const t of entry.tags ?? []) {
      if (t.length === 0 || TAG_PLACEHOLDER.test(t)) continue;
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const epic = entry.epic ?? "";
    if (epic) {
      bindings++;
      epicCounts.set(epic, (epicCounts.get(epic) ?? 0) + 1);
    }
    const status = entryStatus(entry);
    if (status && resolveStatus(status, {}).value === "Done") done++;
  }
  const top = (m: Map<string, number>): [string, number][] =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    tickets: Object.keys(index).length,
    distinctTags: tagCounts.size,
    bindings,
    done,
    topTags: top(tagCounts),
    topEpics: top(epicCounts),
  };
}

/** (c) **Related:** refs in plan .md files that name no known plan file. */
export function danglingRelated(
  files: Record<string, string>,
  known: Set<string>,
): { file: string; ref: string; }[] {
  const rows: { file: string; ref: string; }[] = [];
  for (const [file, text] of Object.entries(files)) {
    for (const ref of relatedRefs(text, known).dangling) rows.push({ file, ref });
  }
  return rows;
}
