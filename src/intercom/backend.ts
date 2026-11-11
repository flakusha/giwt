// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Backend seam selection for the intercom event stream. The default is
 * jsonl; `[intercom] backend = "pijul"` opts into the dogfood backend
 * (backend-pijul.ts) without touching any default flow.
 */

import { backendJsonl } from "./backend-jsonl";
import { type IntercomBackendImpl } from "./types";

/** Select the event-stream engine by name (jsonl default). */
export function backendFor(backend: "jsonl" | "pijul"): IntercomBackendImpl {
  if (backend === "pijul") {
    // Wired in the dogfood-backend phase; phase 1 ships the jsonl engine
    // only, and never silently substitutes it for a configured pijul store.
    throw new Error("[intercom] backend pijul is not wired in this build — set backend = 'jsonl'");
  }
  return backendJsonl;
}
