// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Plan-interconnect graph types: the derived producer/consumer/sibling
 * graph between `.plan/` tickets/epics and the src/ paths they own
 * (FEAT-plan-links-derive-and-validate-producers-consumers-siblings).
 *
 * Edge vocabulary (direction is structural, never guessed from titles):
 *   produces — plan node → src path it owns (code-map.json / src refs)
 *   consumes — plan A → plan B when A **Related:**-names B and both own a
 *              shared src path; `via` names the shared path(s)
 *   sibling  — co-owners of a shared src path with no Related direction
 *   owns     — epic → ticket (**Epic:** membership)
 *   related  — resolved **Related:** link, independent of src paths
 */

export type InterconnectNodeKind = "ticket" | "epic";

export type InterconnectEdgeKind = "produces" | "consumes" | "sibling" | "owns" | "related";

/** One plan file as a graph node. `path` is repo-relative (forward slashes). */
export interface InterconnectNode {
  /** Slug: file basename minus `.md`; unique per graph. */
  id: string;
  kind: InterconnectNodeKind;
  path: string;
  title: string;
  /** Canonical status vocabulary value (status-vocab normalized). */
  status: string;
  /** src/ paths this node owns, sorted. */
  srcRefs: string[];
  /** Resolved **Related:** target node ids, sorted. */
  related: string[];
}

/** One src/ path with the plan nodes that own it. */
export interface InterconnectSrcNode {
  path: string;
  /** Owning node ids, sorted. */
  owners: string[];
}

/** One directed/labeled graph edge. `via` is present only for edges that
 * arise from a shared src path (consumes/sibling); `; `-joined when the
 * pair shares several. */
export interface InterconnectEdge {
  from: string;
  kind: InterconnectEdgeKind;
  to: string;
  via?: string;
}

/** A validation finding with the triple the ticket demands: file, field,
 * path. `field` names the header field or input artifact at fault. */
export interface InterconnectFinding {
  level: "error" | "warn";
  file: string;
  field: string;
  message: string;
}

/** Derived graph + findings. Arrays are fully sorted (byte-stable). */
export interface InterconnectGraph {
  nodes: InterconnectNode[];
  srcNodes: InterconnectSrcNode[];
  edges: InterconnectEdge[];
  findings: InterconnectFinding[];
}

/** Inputs for graph derivation. Absolute paths; the ticket index is
 * optional (extid resolution degrades with a warn finding when absent). */
export interface InterconnectOptions {
  projectRoot: string;
  ticketsDir: string;
  epicsDir: string;
  codeMapPath: string;
  indexPath?: string;
}

/** Everything `plan links` needs in one shot: the graph plus both renders. */
export interface InterconnectOutputs {
  graph: InterconnectGraph;
  json: string;
  md: string;
}
