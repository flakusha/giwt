// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * giwt public API — the stable surface external components should import.
 *
 * Consumers:
 *   - Programmatic use: `import { loadConfig, runSync } from "giwt"`
 *     (or the relative deep path `<repo>/src/index.ts` from a sibling
 *     checkout, e.g. `bun run scripts/worktree` in loop-lore).
 *   - CLI execution stays `src/cli.ts` (package.json `bin`), which is a
 *     thin consumer of this module's `main`.
 *
 * Only add exports here deliberately: everything re-exported becomes a
 * compatibility promise for external callers.
 */

// CLI entry (direct execution / embedding)
export { main } from "./cli";

// Unified logger
export {
  colorize,
  log,
  type OutputFormat,
  raw,
  section,
  setLogLevel,
  setOutputFormat,
} from "./utils/output";
export type { LogLevel } from "./utils/output";

// Layered settings (defaults < ~/.config/giwt/config.toml < giwt.toml < env)
export { loadSettings } from "./utils/settings";
export type { GiwtSettings, SettingsPaths } from "./utils/settings";

// Resolved worktree configuration
export { branchToPath, linkWorktreeCredentials, loadConfig, resolveBranch } from "./utils/config";
export type { WorktreeConfig } from "./utils/config";

// Agent ledger (shared .ledger.jsonl)
export {
  appendCommitOutcome,
  appendGripe,
  appendLedger,
  extractSayArgs,
  LEDGER_DUMP_DEFAULT,
  LEDGER_FILENAME,
  LEDGER_MAX_MSG,
  LEDGER_MAX_RECORDS,
  printRecentLedger,
  readLedger,
  truncateMsg,
} from "./utils/ledger";
export type { LedgerRecord, SayArgs } from "./utils/ledger";

// Run records (.tmp/giwt/runs/)
export { activeRun, beginRun, listRuns } from "./utils/runlog";
export type { RunEvent, RunMeta, RunRecorder } from "./utils/runlog";

// Ticket-index sync (`.plan/tickets/index.json` reconciliation)
export { runSync } from "./tickets/sync-index";
export type { SyncOptions } from "./tickets/sync-index";
export type { SyncReport } from "./tickets/sync-ticket";
