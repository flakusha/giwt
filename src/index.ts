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

// Run records (<repoRoot>/.tmp/giwt/runs/ — they must survive worktree removal)
export { activeRun, beginRun, finishActiveRun, formatOutcome, listRuns } from "./utils/runlog";
export type { RunEvent, RunMeta, RunOutcome, RunRecorder, SyncOutcome } from "./utils/runlog";

// Ticket-index sync (`.plan/tickets/index.json` reconciliation)
export { runSync } from "./tickets/sync-index";
export type { SyncOptions, SyncSummary } from "./tickets/sync-index";
export type { SyncReport } from "./tickets/sync-ticket";

// Plan tooling (.plan/ validation, code-map, backlog-sync, docs, links)
export {
  CHECK_IDS,
  checkExitCode,
  parseBiomeOutput,
  parseEslintJson,
  parseJscpdReport,
  parseKnipIssues,
  parseOxlintJson,
  parseTestOutput,
  parseTscOutput,
  runDoctorChecks,
} from "./doctor/check";
export type {
  CheckFinding,
  CheckId,
  CheckResult,
  CheckSeverity,
  CloneFinding,
  DoctorCheckOptions,
  DoctorCheckReport,
  KnipFinding,
  LintFinding,
  SpawnFn,
  TestFailure,
  TodoMatch,
  TscError,
} from "./doctor/check";
export {
  applyFixes as applyBacklogFixes,
  reconcile as reconcileBacklog,
} from "./plan/backlog-sync";
export type { FileMapRow, FixReport, SyncResult as BacklogSyncResult } from "./plan/backlog-sync";
export { checkFile, collectLinks, resolveTarget, runLinkCheck } from "./plan/check-links";
export type { BrokenLink, LinkCheckResult, OrphanTaskRef } from "./plan/check-links";
export { buildMap, findOwners, findStale, readMap, verifyFresh, writeMap } from "./plan/code-map";
export type { CodeMap, RefEntry, ScanSource } from "./plan/code-map";
export { collectEpics, genDocs, generateIndex, parseEpic } from "./plan/gen-docs";
export type { Epic } from "./plan/gen-docs";
export {
  extractComments,
  extractDocRefs,
  extractSrcRefs,
  stripMarkdownCode,
} from "./plan/src-refs";
export type { DocRef, SrcRef } from "./plan/src-refs";
export { ALL_GATES, FIXABLE_GATES, runValidate } from "./plan/validate";
export type {
  Finding,
  GateName,
  GateResult,
  ValidateOptions,
  ValidateResult,
} from "./plan/validate";
