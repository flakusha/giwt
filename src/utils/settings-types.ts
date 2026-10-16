// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pure settings data: the {@link GiwtSettings} shape and its defaults.
 * Split from settings.ts (loading/merging/env layer) to keep both halves
 * under the file-size budget; re-exported from settings.ts so every
 * existing `from "./settings"` import keeps working.
 */

import { DEFAULT_SCRATCH_CONFIG, DEFAULT_SCRATCHPAD_THRESHOLDS } from "./scratch";
import { DEFAULT_TMP_OPTIONS } from "./tmpscan";

/** Linearity policy for `giwt history audit` ([audit] linearity). */
export type AuditLinearity = "auto" | "require-linear" | "allow-merges";

/** Policy for giwt's own lifecycle git-config writes ([git] config_writes). */
export type ConfigWritesMode = "allow" | "refuse";

export interface GiwtSettings {
  branches: { protected: string[]; root: string; };
  paths: { tree: string; tickets: string; planDir: string; runlog: string; checkReport: string; };
  commands: { check: string; test: string; diffBase: boolean; };
  doctor: {
    jobs: number;
    timeoutMs: number;
    /** MB of memory the doctor pool may assume. 0 = auto (OS free memory). */
    memoryBudgetMb: number;
    scratchpadWarnMb: number;
    scratchpadErrorMb: number;
    scratchpadOrphanWarn: number;
    scratchpadOldestWarnDays: number;
  };
  audit: { linearity: AuditLinearity; patchIds: boolean; maxFindings: number; };
  runlog: { maxRuns: number; };
  output: { format: string; streamTail: number; color: string; };
  scratch: {
    tmpMaxAgeDays: number;
    lcovKeepLatest: number;
    jscpdMaxAgeDays: number;
    checkReportKeep: number;
    root: string;
  };
  tmp: { root: string; prefixes: string[]; maxAgeHours: number; };
  status: { aliases: Record<string, string>; };
  plan: { interconnect: boolean; };
  git: {
    rtk: string;
    safe: string[];
    allow: string[];
    deny: string[];
    classify: string;
    configWrites: ConfigWritesMode;
  };
}

export const DEFAULT_SETTINGS: GiwtSettings = {
  branches: { protected: ["master", "main", "stg", "dev"], root: "dev" },
  paths: {
    tree: "tree",
    tickets: ".plan/tickets",
    planDir: ".plan",
    runlog: ".tmp/giwt",
    checkReport: ".tmp/check-report.json",
  },
  commands: { check: "bun run check", test: "bun run test:unit", diffBase: true },
  doctor: {
    jobs: 1,
    timeoutMs: 120_000,
    memoryBudgetMb: 0,
    scratchpadWarnMb: DEFAULT_SCRATCHPAD_THRESHOLDS.warnMb,
    scratchpadErrorMb: DEFAULT_SCRATCHPAD_THRESHOLDS.errorMb,
    scratchpadOrphanWarn: DEFAULT_SCRATCHPAD_THRESHOLDS.orphanWarn,
    scratchpadOldestWarnDays: DEFAULT_SCRATCHPAD_THRESHOLDS.oldestWarnDays,
  },
  audit: { linearity: "auto", patchIds: true, maxFindings: 200 },
  runlog: { maxRuns: 200 },
  output: { format: "simple", streamTail: 25, color: "auto" },
  scratch: { ...DEFAULT_SCRATCH_CONFIG, root: ".tmp" },
  tmp: {
    root: "/tmp",
    prefixes: DEFAULT_TMP_OPTIONS.prefixes,
    maxAgeHours: DEFAULT_TMP_OPTIONS.maxAgeHours,
  },
  status: { aliases: {} },
  plan: { interconnect: true },
  git: { rtk: "auto", safe: [], allow: [], deny: [], classify: "builtin", configWrites: "allow" },
};
