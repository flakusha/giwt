// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure reconciliation logic for .plan/tickets/index.json sync.
 *
 * Kept free of process.exit / argv so it can be unit-tested (see
 * scripts/sync-ticket-index.test.ts). `reconcile` is parameterized by the
 * repo root and tickets dir so tests can point it at fixture directories.
 *
 * Layout (this file is the public shell — every historical import path
 * `./sync-ticket` keeps working):
 *   - sync-ticket-types.ts       TicketFile / GitIssue / IndexEntry / SyncReport
 *   - sync-normalize.ts          normalizeStatus
 *   - sync-reconcile.ts          gitObjectExists + reconcile core (steps 1–5)
 *   - sync-reconcile-checks.ts   link/stale/orphan, lifecycle drift, status
 *                                drift, unbound-epic passes (steps 6–11)
 */

export { normalizeStatus } from "./sync-normalize";
export { gitObjectExists, reconcile } from "./sync-reconcile";
export type { GitIssue, IndexEntry, SyncReport } from "./sync-ticket-types";
