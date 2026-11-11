// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt intercom claim` / `giwt intercom done` — the mutating lane
 * operations. Both append an envelope event to the stream after their
 * file-level effect (claim file first — the kernel arbitrates the claim;
 * event second — history records what happened). The actor is --owner,
 * else GIWT_AGENT ?? `host:pid` (ledger convention).
 */

import { checkLaneName, claimLane, hasClaim, writeFixed } from "./claims";
import { agentIdentity } from "./ids";
import { resolveExistingStore } from "./store";
import type { IntercomBackendImpl } from "./types";

export interface ClaimResult {
  lane: string;
  owner: string;
  claimPath: string;
}

/** Claim a lane in the project store (throws when already claimed). */
export function runClaim(
  repoRoot: string,
  backend: IntercomBackendImpl,
  opts: { lane: string; owner?: string; scope?: string; },
): ClaimResult {
  const lane = checkLaneName(opts.lane);
  const { storeDir } = resolveExistingStore(repoRoot);
  const actor = opts.owner ?? agentIdentity();
  const claimPath = claimLane(storeDir, lane, actor, opts.scope);
  backend.appendEvent(storeDir, {
    actor,
    type: "claim",
    lane,
    refs: [],
    body: opts.scope ?? "",
  });
  return { lane, owner: actor, claimPath };
}

export interface DoneResult {
  lane: string;
  fixedPath: string;
  wasClaimed: boolean;
}

/**
 * Record completion for a lane. Allowed without a live claim (the field
 * data shows FIXED-without-LANE is common — renamed lanes, implicit
 * assignment); the event notes the orphan so `ls` can pair stems later.
 */
export function runDone(
  repoRoot: string,
  backend: IntercomBackendImpl,
  opts: { lane: string; owner?: string; note?: string; detailPath?: string; },
): DoneResult {
  const lane = checkLaneName(opts.lane);
  const { storeDir } = resolveExistingStore(repoRoot);
  const wasClaimed = hasClaim(storeDir, lane);
  const actor = opts.owner ?? agentIdentity();
  const fixedPath = writeFixed(storeDir, lane, {
    owner: actor,
    ...(opts.note !== undefined ? { note: opts.note } : {}),
    ...(opts.detailPath !== undefined ? { detailPath: opts.detailPath } : {}),
  });
  backend.appendEvent(storeDir, {
    actor,
    type: "done",
    lane,
    refs: [],
    body: opts.note ?? "",
  });
  return { lane, fixedPath, wasClaimed };
}
