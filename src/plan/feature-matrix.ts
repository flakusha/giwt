// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Feature matrix — deterministic projection of the ticket index.
 *
 * buildMatrix() is pure (no fs): tags/epics become rows, normalizeStatus
 * buckets become columns, cells are counts. The markdown renderer is pure
 * too — no timestamps — so freshness is exact string equality, identical
 * to the epics-doc gate precedent. Freeform statuses land in `other`,
 * never coerced; untagged/unbound tickets surface as visible synthetic
 * rows, never silently dropped. See ticket
 * FEAT-feature-matrix-generation-from-ticket-index.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { type IndexEntry, normalizeStatus } from "../tickets/sync-ticket";

export interface MatrixStatuses {
  done: number;
  in_progress: number;
  open: number;
  draft: number;
  cancelled: number;
  other: number;
}

export interface MatrixRow {
  key: string;
  total: number;
  statuses: MatrixStatuses;
  tickets: string[];
}

export interface FeatureMatrix {
  total: number;
  byTag: MatrixRow[];
  byEpic: MatrixRow[];
  untagged: number;
  unbound: number;
}

/** Normalized status buckets in fixed column order; anything else is `other`. */
const STATUS_COLUMNS = ["done", "in_progress", "open", "draft", "cancelled", "other"] as const;

type StatusBucket = (typeof STATUS_COLUMNS)[number];

const UNTAGGED = "(untagged)";
const UNBOUND = "(unbound)";

function emptyStatuses(): MatrixStatuses {
  return { done: 0, in_progress: 0, open: 0, draft: 0, cancelled: 0, other: 0 };
}

/** One of the STATUS_COLUMNS, or "other" for freeform passthrough values. */
function bucketOf(status: string | undefined): StatusBucket {
  const s = normalizeStatus(status ?? "undefined");
  return ((STATUS_COLUMNS as readonly string[]).includes(s) ? s : "other") as StatusBucket;
}

function rowFor(map: Map<string, MatrixRow>, key: string): MatrixRow {
  let row = map.get(key);
  if (!row) {
    row = { key, total: 0, statuses: emptyStatuses(), tickets: [] };
    map.set(key, row);
  }
  return row;
}

function credit(row: MatrixRow, extid: string, bucket: StatusBucket): void {
  row.total++;
  row.statuses[bucket]++;
  row.tickets.push(extid);
}

/** localeCompare sort with the synthetic row forced last. */
function sortRows(map: Map<string, MatrixRow>, synthetic: string): MatrixRow[] {
  return [...map.values()].sort((a, b) => {
    if (a.key === synthetic) return 1;
    if (b.key === synthetic) return -1;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Pure projection: Record<extid, IndexEntry> → FeatureMatrix.
 * Deterministic regardless of input key order; extids sorted per row.
 */
export function buildMatrix(entries: Record<string, IndexEntry>): FeatureMatrix {
  const tagRows = new Map<string, MatrixRow>();
  const untaggedRow = rowFor(tagRows, UNTAGGED);
  const epicRows = new Map<string, MatrixRow>();
  const unboundRow = rowFor(epicRows, UNBOUND);
  let total = 0;

  for (const [extid, entry] of Object.entries(entries)) {
    total++;
    const bucket = bucketOf(entry.status);
    const tags = entry.tags ?? [];
    if (tags.length === 0) credit(untaggedRow, extid, bucket);
    for (const tag of tags) credit(rowFor(tagRows, tag), extid, bucket);
    const epic = entry.epic ?? "";
    credit(rowFor(epicRows, epic === "" ? UNBOUND : epic), extid, bucket);
  }

  for (const row of [...tagRows.values(), ...epicRows.values()]) row.tickets.sort();
  // Zero-total synthetic rows are noise — only render when untagged/unbound
  // tickets actually exist.
  if (untaggedRow.total === 0) tagRows.delete(UNTAGGED);
  if (unboundRow.total === 0) epicRows.delete(UNBOUND);

  return {
    total,
    byTag: sortRows(tagRows, UNTAGGED),
    byEpic: sortRows(epicRows, UNBOUND),
    untagged: untaggedRow.total,
    unbound: unboundRow.total,
  };
}

function statusTable(rows: MatrixRow[], label: string): string[] {
  const lines = [
    `| ${label} | Total | ${STATUS_COLUMNS.join(" | ")} |`,
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    const cells = STATUS_COLUMNS.map((c) => r.statuses[c]).join(" | ");
    lines.push(`| ${r.key} | ${r.total} | ${cells} |`);
  }
  return lines;
}

function detailList(rows: MatrixRow[]): string[] {
  if (rows.length === 0) return ["(none)"];
  return rows.map((r) => `- \`${r.key}\` (${r.total}): ${r.tickets.join(", ")}`);
}

/** tag×tag shared-ticket counts, upper triangle in existing (sorted) row order. */
function cooccurrenceTable(rows: MatrixRow[]): string[] {
  const tags = rows.filter((r) => r.key !== UNTAGGED).map((r) => ({
    key: r.key,
    set: new Set(r.tickets),
  }));
  const lines = ["| Tag | Tag | Shared |", "| --- | --- | ---: |"];
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i]!;
      const b = tags[j]!;
      let shared = 0;
      for (const t of a.set) if (b.set.has(t)) shared++;
      if (shared > 0) lines.push(`| ${a.key} | ${b.key} | ${shared} |`);
    }
  }
  return lines;
}

/**
 * Pure markdown rendering. No timestamps — byte-identical output for the
 * same matrix, so the validate gate compares with string equality.
 */
export function generateMatrixMarkdown(
  m: FeatureMatrix,
  opts: { cooccurrence?: boolean; } = {},
): string {
  const lines = [
    "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->",
    "<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->",
    "",
    "<!-- Do not edit manually — regenerate with `giwt plan matrix` -->",
    "",
    "# Feature matrix",
    "",
    `Total tickets: **${m.total}** — untagged: **${m.untagged}** — unbound to epic: **${m.unbound}**`,
    "",
    "## By tag × status",
    "",
    ...statusTable(m.byTag, "Tag"),
    "",
    "## By epic × status",
    "",
    ...statusTable(m.byEpic, "Epic"),
    "",
    "## Ticket detail",
    "",
    "### By tag",
    "",
    ...detailList(m.byTag),
    "",
    "### By epic",
    "",
    ...detailList(m.byEpic),
    "",
  ];
  if (opts.cooccurrence) {
    lines.push("## Tag co-occurrence", "", ...cooccurrenceTable(m.byTag), "");
  }
  return lines.join("\n");
}

/** Read + parse the ticket index; errors name the path (repo convention). */
export function readTicketIndex(indexPath: string): Record<string, IndexEntry> {
  let text: string;
  try {
    text = readFileSync(indexPath, "utf8");
  } catch (error) {
    throw new Error(`${indexPath}: unreadable (${(error as Error).message})`, { cause: error });
  }
  try {
    return JSON.parse(text) as Record<string, IndexEntry>;
  } catch (error) {
    throw new Error(`${indexPath}: invalid JSON (${(error as Error).message})`, { cause: error });
  }
}

/** Build + render without writing — the --check/--json path. */
export function matrixOutput(
  indexPath: string,
  opts: { cooccurrence?: boolean; } = {},
): { matrix: FeatureMatrix; output: string; } {
  const matrix = buildMatrix(readTicketIndex(indexPath));
  return { matrix, output: generateMatrixMarkdown(matrix, opts) };
}

/** Full generation: read index, render, write the markdown file. */
export function genMatrix(
  indexPath: string,
  outPath: string,
  opts: { cooccurrence?: boolean; } = {},
): { matrix: FeatureMatrix; output: string; } {
  const result = matrixOutput(indexPath, opts);
  writeFileSync(outPath, result.output);
  return result;
}
