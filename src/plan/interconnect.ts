// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Plan interconnect — public surface (FEAT-plan-links-derive-and-validate-
 * producers-consumers-siblings). Derives the producer/consumer/sibling
 * graph between `.plan/` tickets/epics and src/ ownership, renders the
 * byte-stable `.plan/interconnect.json`/`.md` pair, and validates
 * **Related:** links. Implementation lives in ./interconnect/*.
 */

export { buildInterconnect, verifySnapshotStable } from "./interconnect/build";
export { runInterconnectGate } from "./interconnect/gate";
export {
  edgesTouching,
  findNode,
  nodeReport,
  siblingsOf,
  whoConsumes,
  whoProduces,
} from "./interconnect/query";
export type { NodeReport } from "./interconnect/query";
export {
  freshnessFindings,
  interconnectOutputs,
  renderInterconnectJson,
  renderInterconnectMd,
  writeInterconnectFiles,
} from "./interconnect/render";
export { resolveRef } from "./interconnect/resolve";
export type {
  InterconnectEdge,
  InterconnectFinding,
  InterconnectGraph,
  InterconnectNode,
  InterconnectOptions,
  InterconnectOutputs,
  InterconnectSrcNode,
} from "./interconnect/types";
