// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure queries over a derived interconnect graph, shared by the CLI flags
 * (--for / --who-produces / --who-consumes / --siblings) and public
 * consumers. Targets may be a plan node id or a src path; resolution is
 * exact-match against node ids first, then src paths.
 */

import type { InterconnectEdge, InterconnectGraph, InterconnectNode } from "./types";

export interface NodeReport {
  node: InterconnectNode;
  /** Every edge touching the node (either endpoint). */
  edges: InterconnectEdge[];
}

/** The node with this exact id, or null. */
export function findNode(graph: InterconnectGraph, id: string): InterconnectNode | null {
  return graph.nodes.find((n) => n.id === id) ?? null;
}

/** All edges touching `id` (either endpoint). */
export function edgesTouching(graph: InterconnectGraph, id: string): InterconnectEdge[] {
  return graph.edges.filter((e) => e.from === id || e.to === id);
}

/** Node report for `--for <id>`; null when the id names no node. */
export function nodeReport(graph: InterconnectGraph, id: string): NodeReport | null {
  const node = findNode(graph, id);
  return node === null ? null : { node, edges: edgesTouching(graph, id) };
}

/**
 * `--who-produces <target>`: for a src path, the plan nodes that own it;
 * for a plan node id, the nodes it consumes from on shared src paths (its
 * Related-named co-owners — they produce the code this node builds on).
 * Null when the target matches neither a src path nor a node id.
 */
export function whoProduces(graph: InterconnectGraph, target: string): string[] | null {
  const src = graph.srcNodes.find((s) => s.path === target);
  if (src !== undefined) return [...src.owners];
  if (findNode(graph, target) === null) return null;
  return graph.edges
    .filter((e) => e.kind === "consumes" && e.from === target)
    .map((e) => e.to)
    .sort();
}

/**
 * `--who-consumes <target>`: for a src path, the plan nodes that consume
 * someone else's code through it; for a plan node id, the nodes that
 * depend on it (Related-naming it over shared src paths). Null when the
 * target matches neither.
 */
export function whoConsumes(graph: InterconnectGraph, target: string): string[] | null {
  const isSrc = graph.srcNodes.some((s) => s.path === target);
  if (isSrc) {
    return graph.edges
      .filter((e) => e.kind === "consumes" && (e.via?.split("; ").includes(target) ?? false))
      .map((e) => e.from)
      .sort();
  }
  if (findNode(graph, target) === null) return null;
  return graph.edges
    .filter((e) => e.kind === "consumes" && e.to === target)
    .map((e) => e.from)
    .sort();
}

/** `--siblings <id>`: co-owners of shared src paths with no Related
 * direction; null when the id names no node. */
export function siblingsOf(graph: InterconnectGraph, id: string): InterconnectEdge[] | null {
  if (findNode(graph, id) === null) return null;
  return graph.edges.filter(
    (e) => e.kind === "sibling" && (e.from === id || e.to === id),
  );
}
