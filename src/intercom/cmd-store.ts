// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt intercom init` — resolve the project identity, create the durable
 * store, scaffold the backend, and expose it as `.tmp/intercom` in THIS
 * checkout. Idempotent: re-running repairs a dangling link and no-ops on
 * a healthy store.
 */

import { join } from "node:path";
import { log, raw } from "../utils/output";
import { backendFor } from "./backend";
import { projectIdentity } from "./ids";
import { ensureLink, ensureStore, linkStatus } from "./store";

export interface InitSummary {
  storeDir: string;
  created: boolean;
  backend: "jsonl" | "pijul";
  link: string;
  target: string | null;
}

/**
 * Create/repair the store + exposure link. Throws on a wrong-target link
 * (refuse + report, never silently re-point) and on a backend flip.
 */
export function runInit(
  repoRoot: string,
  worktreeRoot: string,
  backendName: "jsonl" | "pijul",
): InitSummary {
  const identity = projectIdentity(repoRoot);
  const { storeDir, created } = ensureStore(identity, backendName);
  backendFor(backendName).initStore(storeDir);
  ensureLink(worktreeRoot, storeDir);
  const status = linkStatus(worktreeRoot, storeDir);
  return {
    storeDir,
    created,
    backend: backendName,
    link: join(worktreeRoot, ".tmp", "intercom"),
    target: status.state === "ok" ? status.target : null,
  };
}

/** Human rendering of the init result (no outcome line — caller owns it). */
export function printInitSummary(s: InitSummary): void {
  raw(`  store: ${s.storeDir}${s.created ? " (created)" : ""}`);
  raw(`  backend: ${s.backend}`);
  raw(`  link: ${s.link} -> ${s.target ?? "(real dir fallback)"}`);
  if (s.target === null) {
    log("warn", "cross-checkout coordination is off on this checkout (symlink fallback active)");
  }
}
