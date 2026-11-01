// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Feature-matrix-derived sibling edges (FEAT-…-derive-producers-consumers-
 * siblings-from-f): plan entries co-membered in a buildMatrix byTag/byEpic
 * row are siblings. Producers/consumers are NOT derived here — a matrix
 * row has no direction, so fabricating one would be a guess; production
 * and consumption stay frontmatter-declared (**Related:** over shared src
 * paths, **Generates:** for artifacts).
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { IndexEntry } from "../../tickets/sync-ticket-types";
import { buildMatrix, type MatrixRow } from "../feature-matrix";
import { pushVia } from "./build";
import { byStr } from "./resolve";
import type { InterconnectEdge, InterconnectNode, InterconnectOptions } from "./types";

/** feature-matrix's synthetic rows (constants are unexported there): every
 * untagged/unbound entry lands in one shared row, so co-membership is pure
 * noise — never a sibling fact. */
const SYNTHETIC_ROWS = new Set(["(untagged)", "(unbound)"]);

/** Ticket-index entries for matrix derivation, or null when derivation is
 * off. Undefined/missing/unparseable indexes all yield null WITHOUT a new
 * finding — buildResolution already emits the degraded-resolution warn for
 * exactly those causes. Entries are not stamp-checked here: the index is
 * read tolerantly, matching buildResolution. Non-object entries (hand-
 * corrupted `null` values) are dropped — buildMatrix dereferences entry
 * fields and would otherwise throw, turning a degraded index into a
 * links CLI crash. */
export function readIndexEntries(
  opts: InterconnectOptions,
): Record<string, IndexEntry> | null {
  if (opts.indexPath === undefined || !existsSync(opts.indexPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(opts.indexPath, "utf8"));
  } catch {
    return null; // already warned by buildResolution
  }
  if (raw === null || typeof raw !== "object") return null;
  const entries: Record<string, IndexEntry> = {};
  for (const [extid, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object") continue;
    entries[extid] = entry as IndexEntry;
  }
  return entries;
}

/** Node ids for a matrix row's extids: index entry → source basename slug,
 * kept only when it names a graph node (stale index entries for deleted or
 * out-of-plan sources drop out silently — index freshness is not this
 * gate's job). Sorted, deduped. */
function rowNodeIds(
  row: MatrixRow,
  entries: Record<string, IndexEntry>,
  nodeIds: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const extid of row.tickets) {
    const source = entries[extid]?.source;
    if (source === undefined) continue;
    const id = basename(source).replace(/\.md$/, "");
    if (nodeIds.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.sort(byStr);
}

/**
 * One `sibling` edge per unordered pair co-membered in any byTag or byEpic
 * row; the shared rows merge into `via` (`tag:<key>` / `epic:<key>`, the
 * pushVia pattern). Guards follow deriveEdges precedent: no self-edges;
 * pairs with an explicit **Related:** direction (either way) are skipped —
 * direction beats co-membership; pairs already sibling via a shared src
 * path are skipped — at most one sibling record per pair, so derivation
 * never duplicates an existing record. Every edge carries `derived: true`
 * so declared vs derived stays distinguishable in render + query output.
 * Deterministic: byStr sorts everywhere.
 */
export function deriveMatrixSiblingEdges(
  entries: Record<string, IndexEntry> | null,
  nodes: InterconnectNode[],
  relatedSet: Set<string>,
  srcSiblingPairs: Set<string>,
): InterconnectEdge[] {
  if (entries === null) return [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const matrix = buildMatrix(entries);
  const pairVia = new Map<string, string[]>();
  const collect = (rows: MatrixRow[], prefix: string): void => {
    for (const row of rows) {
      if (SYNTHETIC_ROWS.has(row.key)) continue;
      const ids = rowNodeIds(row, entries, nodeIds);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i]!;
          const b = ids[j]!;
          if (relatedSet.has(`${a}->${b}`) || relatedSet.has(`${b}->${a}`)) continue;
          if (srcSiblingPairs.has(`${a}|${b}`)) continue;
          pushVia(pairVia, `${a}|${b}`, `${prefix}${row.key}`);
        }
      }
    }
  };
  collect(matrix.byTag, "tag:");
  collect(matrix.byEpic, "epic:");
  return [...pairVia.entries()]
    .sort((x, y) => byStr(x[0], y[0]))
    .map(([key, via]): InterconnectEdge => {
      const [from, to] = key.split("|");
      return {
        from: from!,
        kind: "sibling",
        to: to!,
        via: [...via].sort(byStr).join("; "),
        derived: true,
      };
    });
}
